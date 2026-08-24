import { Test } from '@nestjs/testing';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Achievement, User } from '@prisma/client';
import { AchievementsService } from './achievements.service';
import { PrismaService } from '../prisma/prisma.service';
import { AppEvents } from '../common/events/app-events';
import { AchievementUnlockedEvent } from '../common/events/achievement-unlocked.event';

function makeAchievement(overrides: Partial<Achievement>): Achievement {
  return {
    id: 'achievement-id',
    name: 'Achievement',
    slug: 'achievement',
    group: 'purchases',
    threshold: 1,
    description: null,
    order: 1,
    createdAt: new Date(),
    ...overrides,
  };
}

const fakeUser = { id: 'user-1', name: 'Test User' } as User;

describe('AchievementsService', () => {
  let service: AchievementsService;
  let eventEmitter: { emitAsync: jest.Mock };

  beforeEach(() => {
    eventEmitter = { emitAsync: jest.fn() };
  });

  async function buildService(prisma: Record<string, unknown>) {
    const module = await Test.createTestingModule({
      providers: [
        AchievementsService,
        { provide: PrismaService, useValue: prisma },
        { provide: EventEmitter2, useValue: eventEmitter },
      ],
    }).compile();

    return module.get(AchievementsService);
  }

  describe('evaluateAndUnlock', () => {
    // Sets up a Prisma stand-in whose achievement/userAchievement tables are
    // simple in-memory state, so unlocking one achievement is visible to the
    // very next query — the same way it would be against a real database.
    function buildPrismaStub(
      purchaseAchievements: Achievement[],
      countAchievements: Achievement[],
      purchaseCount: number,
      initiallyUnlocked: Achievement[] = [],
    ) {
      const unlocked = new Set(initiallyUnlocked.map((a) => a.id));

      return {
        purchase: { count: jest.fn().mockResolvedValue(purchaseCount) },
        achievement: {
          findMany: jest.fn((args: { where?: { group?: string } }) => {
            if (args.where?.group === 'purchases') {
              return Promise.resolve(purchaseAchievements);
            }
            if (args.where?.group === 'achievements_count') {
              return Promise.resolve(countAchievements);
            }
            return Promise.resolve([
              ...purchaseAchievements,
              ...countAchievements,
            ]);
          }),
        },
        userAchievement: {
          findMany: jest.fn(() =>
            Promise.resolve(
              [...unlocked].map((achievementId) => ({ achievementId })),
            ),
          ),
          createMany: jest.fn(
            ({ data }: { data: { achievementId: string }[] }) => {
              for (const row of data) unlocked.add(row.achievementId);
              return Promise.resolve({ count: data.length });
            },
          ),
        },
        user: {
          findUniqueOrThrow: jest.fn().mockResolvedValue(fakeUser),
        },
      };
    }

    it('unlocks a purchase achievement once its threshold is crossed', async () => {
      const firstPurchase = makeAchievement({
        id: 'first-purchase',
        name: 'First Purchase',
        threshold: 1,
        order: 1,
      });
      const fivePurchases = makeAchievement({
        id: 'five-purchases',
        name: '5 Purchases',
        threshold: 5,
        order: 2,
      });
      const prisma = buildPrismaStub([firstPurchase, fivePurchases], [], 1);
      service = await buildService(prisma);

      await service.evaluateAndUnlock(fakeUser.id);

      expect(prisma.userAchievement.createMany).toHaveBeenCalledWith({
        data: [{ userId: fakeUser.id, achievementId: 'first-purchase' }],
        skipDuplicates: true,
      });
      expect(eventEmitter.emitAsync).toHaveBeenCalledTimes(1);
      expect(eventEmitter.emitAsync).toHaveBeenCalledWith(
        AppEvents.ACHIEVEMENT_UNLOCKED,
        new AchievementUnlockedEvent('First Purchase', fakeUser),
      );
    });

    it('does not re-unlock an already-unlocked achievement', async () => {
      const firstPurchase = makeAchievement({
        id: 'first-purchase',
        name: 'First Purchase',
        threshold: 1,
      });
      const prisma = buildPrismaStub([firstPurchase], [], 1, [firstPurchase]);
      service = await buildService(prisma);

      await service.evaluateAndUnlock(fakeUser.id);

      expect(prisma.userAchievement.createMany).not.toHaveBeenCalled();
      expect(eventEmitter.emitAsync).not.toHaveBeenCalled();
    });

    it('cascades into the achievements_count group when a purchase unlock crosses its threshold', async () => {
      const p1 = makeAchievement({
        id: 'p1',
        name: 'First Purchase',
        threshold: 1,
        order: 1,
      });
      const p2 = makeAchievement({
        id: 'p2',
        name: '2 Purchases',
        threshold: 2,
        order: 2,
      });
      const c1 = makeAchievement({
        id: 'c1',
        name: '2 Achievements',
        group: 'achievements_count',
        threshold: 2,
        order: 1,
      });
      // 2 purchases unlocks both p1 and p2 in one pass, taking the total
      // achievement count to 2 — which should immediately cascade into c1.
      const prisma = buildPrismaStub([p1, p2], [c1], 2);
      service = await buildService(prisma);

      await service.evaluateAndUnlock(fakeUser.id);

      const unlockedNames = (
        eventEmitter.emitAsync.mock.calls as [
          string,
          AchievementUnlockedEvent,
        ][]
      ).map(([, event]) => event.achievement_name);
      expect(unlockedNames).toEqual([
        'First Purchase',
        '2 Purchases',
        '2 Achievements',
      ]);
    });
  });

  describe('getUserAchievementsSummary', () => {
    function buildPrismaStub(options: {
      user: User | null;
      achievements: Achievement[];
      unlocked: Achievement[];
      badges: { id: string; name: string; requiredAchievements: number }[];
    }) {
      return {
        user: { findUnique: jest.fn().mockResolvedValue(options.user) },
        achievement: {
          findMany: jest.fn().mockResolvedValue(options.achievements),
        },
        userAchievement: {
          findMany: jest.fn().mockResolvedValue(
            options.unlocked.map((achievement) => ({
              achievementId: achievement.id,
              achievement,
            })),
          ),
        },
        badge: { findMany: jest.fn().mockResolvedValue(options.badges) },
      };
    }

    it('throws NotFoundException for a user that does not exist', async () => {
      const prisma = buildPrismaStub({
        user: null,
        achievements: [],
        unlocked: [],
        badges: [],
      });
      service = await buildService(prisma);

      await expect(
        service.getUserAchievementsSummary('missing-user'),
      ).rejects.toThrow('User missing-user not found');
    });

    it('returns only the next achievement per group and the correct badge progress', async () => {
      const firstPurchase = makeAchievement({
        id: 'p1',
        name: 'First Purchase',
        group: 'purchases',
        threshold: 1,
        order: 1,
      });
      const fivePurchases = makeAchievement({
        id: 'p2',
        name: '5 Purchases',
        group: 'purchases',
        threshold: 5,
        order: 2,
      });
      const fiveAchievements = makeAchievement({
        id: 'c1',
        name: '5 Achievements',
        group: 'achievements_count',
        threshold: 5,
        order: 1,
      });

      // Ordered the way Prisma's real `orderBy: [{ group: 'asc' }, ...]`
      // would return them — "achievements_count" sorts before "purchases".
      const prisma = buildPrismaStub({
        user: fakeUser,
        achievements: [fiveAchievements, firstPurchase, fivePurchases],
        unlocked: [firstPurchase],
        badges: [
          { id: 'badge-1', name: 'Beginner', requiredAchievements: 3 },
          { id: 'badge-2', name: 'Advanced', requiredAchievements: 8 },
        ],
      });
      service = await buildService(prisma);

      const summary = await service.getUserAchievementsSummary(fakeUser.id);

      expect(summary).toEqual({
        unlocked_achievements: ['First Purchase'],
        next_available_achievements: ['5 Achievements', '5 Purchases'],
        current_badge: null,
        next_badge: 'Beginner',
        remaining_to_unlock_next_badge: 2,
      });
    });

    it('reports the highest earned badge and null next_badge once every badge is unlocked', async () => {
      const onlyAchievement = makeAchievement({ id: 'p1', threshold: 1 });
      const prisma = buildPrismaStub({
        user: fakeUser,
        achievements: [onlyAchievement],
        unlocked: [onlyAchievement],
        badges: [{ id: 'badge-1', name: 'Beginner', requiredAchievements: 1 }],
      });
      service = await buildService(prisma);

      const summary = await service.getUserAchievementsSummary(fakeUser.id);

      expect(summary.current_badge).toBe('Beginner');
      expect(summary.next_badge).toBeNull();
      expect(summary.remaining_to_unlock_next_badge).toBe(0);
    });
  });
});
