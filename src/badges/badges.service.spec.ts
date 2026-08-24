import { Test } from '@nestjs/testing';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Badge, User } from '@prisma/client';
import { BadgesService } from './badges.service';
import { PrismaService } from '../prisma/prisma.service';
import { AppEvents } from '../common/events/app-events';
import { BadgeUnlockedEvent } from '../common/events/badge-unlocked.event';

function makeBadge(overrides: Partial<Badge>): Badge {
  return {
    id: 'badge-id',
    name: 'Badge',
    slug: 'badge',
    requiredAchievements: 1,
    order: 1,
    createdAt: new Date(),
    ...overrides,
  };
}

const fakeUser = { id: 'user-1', name: 'Test User' } as User;

describe('BadgesService', () => {
  let service: BadgesService;
  let eventEmitter: { emitAsync: jest.Mock };

  // In-memory stand-in for the badge/user-badge tables, so unlocking a
  // badge is reflected in the very next query, like a real database.
  function buildPrismaStub(
    badges: Badge[],
    achievementCount: number,
    initiallyUnlocked: Badge[] = [],
  ) {
    const unlockedBadgeIds = new Set(initiallyUnlocked.map((b) => b.id));

    return {
      userAchievement: {
        count: jest.fn().mockResolvedValue(achievementCount),
      },
      badge: { findMany: jest.fn().mockResolvedValue(badges) },
      userBadge: {
        findMany: jest.fn(() =>
          Promise.resolve(
            [...unlockedBadgeIds].map((badgeId) => ({ badgeId })),
          ),
        ),
        createMany: jest.fn(({ data }: { data: { badgeId: string }[] }) => {
          for (const row of data) unlockedBadgeIds.add(row.badgeId);
          return Promise.resolve({ count: data.length });
        }),
      },
      user: {
        update: jest.fn().mockResolvedValue(fakeUser),
        findUniqueOrThrow: jest.fn().mockResolvedValue(fakeUser),
      },
    };
  }

  beforeEach(() => {
    eventEmitter = { emitAsync: jest.fn() };
  });

  async function buildService(prisma: Record<string, unknown>) {
    const module = await Test.createTestingModule({
      providers: [
        BadgesService,
        { provide: PrismaService, useValue: prisma },
        { provide: EventEmitter2, useValue: eventEmitter },
      ],
    }).compile();

    return module.get(BadgesService);
  }

  it('unlocks a badge once the achievement count crosses its threshold', async () => {
    const beginner = makeBadge({
      id: 'beginner',
      name: 'Beginner',
      requiredAchievements: 3,
      order: 1,
    });
    const prisma = buildPrismaStub([beginner], 3);
    service = await buildService(prisma);

    await service.evaluateAndUnlock(fakeUser.id);

    expect(prisma.userBadge.createMany).toHaveBeenCalledWith({
      data: [{ userId: fakeUser.id, badgeId: 'beginner' }],
      skipDuplicates: true,
    });
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: fakeUser.id },
      data: { currentBadgeId: 'beginner' },
    });
    expect(eventEmitter.emitAsync).toHaveBeenCalledWith(
      AppEvents.BADGE_UNLOCKED,
      new BadgeUnlockedEvent('Beginner', fakeUser),
    );
  });

  it('does not re-unlock an already-unlocked badge', async () => {
    const beginner = makeBadge({ id: 'beginner', requiredAchievements: 3 });
    const prisma = buildPrismaStub([beginner], 5, [beginner]);
    service = await buildService(prisma);

    await service.evaluateAndUnlock(fakeUser.id);

    expect(prisma.userBadge.createMany).not.toHaveBeenCalled();
    expect(prisma.user.update).not.toHaveBeenCalled();
    expect(eventEmitter.emitAsync).not.toHaveBeenCalled();
  });

  it('does nothing when the achievement count is below every badge threshold', async () => {
    const beginner = makeBadge({ id: 'beginner', requiredAchievements: 3 });
    const prisma = buildPrismaStub([beginner], 1);
    service = await buildService(prisma);

    await service.evaluateAndUnlock(fakeUser.id);

    expect(prisma.userBadge.createMany).not.toHaveBeenCalled();
    expect(eventEmitter.emitAsync).not.toHaveBeenCalled();
  });

  it('unlocks every crossed tier at once and sets currentBadgeId to the highest one', async () => {
    const beginner = makeBadge({
      id: 'beginner',
      name: 'Beginner',
      requiredAchievements: 3,
      order: 1,
    });
    const intermediate = makeBadge({
      id: 'intermediate',
      name: 'Intermediate',
      requiredAchievements: 5,
      order: 2,
    });
    const advanced = makeBadge({
      id: 'advanced',
      name: 'Advanced',
      requiredAchievements: 8,
      order: 3,
    });
    // A single evaluation jumps straight from 0 to 8 unlocked achievements
    // (e.g. a batch import), which should cross all three thresholds at once.
    const prisma = buildPrismaStub([beginner, intermediate, advanced], 8);
    service = await buildService(prisma);

    await service.evaluateAndUnlock(fakeUser.id);

    expect(prisma.userBadge.createMany).toHaveBeenCalledWith({
      data: [
        { userId: fakeUser.id, badgeId: 'beginner' },
        { userId: fakeUser.id, badgeId: 'intermediate' },
        { userId: fakeUser.id, badgeId: 'advanced' },
      ],
      skipDuplicates: true,
    });
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: fakeUser.id },
      data: { currentBadgeId: 'advanced' },
    });

    const unlockedNames = (
      eventEmitter.emitAsync.mock.calls as [string, BadgeUnlockedEvent][]
    ).map(([, event]) => event.badge_name);
    expect(unlockedNames).toEqual(['Beginner', 'Intermediate', 'Advanced']);
  });
});
