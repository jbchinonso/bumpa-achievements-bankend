import { Injectable, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Achievement } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AppEvents } from '../common/events/app-events';
import { AchievementUnlockedEvent } from '../common/events/achievement-unlocked.event';

@Injectable()
export class AchievementsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  findAll() {
    return this.prisma.achievement.findMany({
      orderBy: [{ group: 'asc' }, { order: 'asc' }],
    });
  }

  // Evaluates both achievement groups and unlocks whatever the user newly
  // qualifies for. The two groups work differently, so they're handled
  // separately
  async evaluateAndUnlock(userId: string): Promise<void> {
    await this.unlockPurchaseAchievements(userId);
    await this.unlockAchievementCountAchievements(userId);
  }

  private async unlockPurchaseAchievements(userId: string): Promise<void> {
    const purchaseCount = await this.prisma.purchase.count({
      where: { userId },
    });
    const purchaseAchievements = await this.prisma.achievement.findMany({
      where: { group: 'purchases' },
      orderBy: { order: 'asc' },
    });
    const alreadyUnlocked = await this.getUnlockedAchievementIds(userId);

    const toUnlock = purchaseAchievements.filter(
      (achievement) =>
        !alreadyUnlocked.has(achievement.id) &&
        purchaseCount >= achievement.threshold,
    );

    await this.unlockAchievements(userId, toUnlock);
  }

  private async unlockAchievementCountAchievements(
    userId: string,
  ): Promise<void> {
    const countAchievements = await this.prisma.achievement.findMany({
      where: { group: 'achievements_count' },
      orderBy: { order: 'asc' },
    });

    // Loop: unlocking one of these achievements raises the total count,
    // which can immediately qualify the next one too (a cascade).

    while (true) {
      const alreadyUnlocked = await this.getUnlockedAchievementIds(userId);
      const totalUnlocked = alreadyUnlocked.size;

      const toUnlock = countAchievements.filter(
        (achievement) =>
          !alreadyUnlocked.has(achievement.id) &&
          totalUnlocked >= achievement.threshold,
      );

      if (toUnlock.length === 0) break;

      await this.unlockAchievements(userId, toUnlock);
    }
  }

  private async getUnlockedAchievementIds(
    userId: string,
  ): Promise<Set<string>> {
    const unlocked = await this.prisma.userAchievement.findMany({
      where: { userId },
      select: { achievementId: true },
    });
    return new Set(unlocked.map((u) => u.achievementId));
  }

  private async unlockAchievements(
    userId: string,
    achievements: Achievement[],
  ): Promise<void> {
    if (achievements.length === 0) return;

    await this.prisma.userAchievement.createMany({
      data: achievements.map((achievement) => ({
        userId,
        achievementId: achievement.id,
      })),
      skipDuplicates: true,
    });

    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
    });

    for (const achievement of achievements) {
      await this.eventEmitter.emitAsync(
        AppEvents.ACHIEVEMENT_UNLOCKED,
        new AchievementUnlockedEvent(achievement.name, user),
      );
    }
  }

  async getUserAchievementsSummary(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException(`User ${userId} not found`);
    }

    const achievements = await this.findAll();
    const userAchievements = await this.prisma.userAchievement.findMany({
      where: { userId },
      orderBy: { unlockedAt: 'asc' },
      include: { achievement: true },
    });
    const unlockedIds = new Set(userAchievements.map((userAchievement) => userAchievement.achievementId));

    const unlockedAchievements = userAchievements.map(
      (userAchievement) => userAchievement.achievement.name
    );

    // Only the next achievement per group, in that group's defined order.
    const groups = [...new Set(achievements.map((achievement) => achievement.group))];
    const nextAvailableAchievements = groups
      .map((group) =>
        achievements.find((achievement) => achievement.group === group && !unlockedIds.has(achievement.id)),
      )
      .filter((achievement) => achievement !== undefined)
      .map((achievement) => achievement.name);

    const badges = await this.prisma.badge.findMany({
      orderBy: { requiredAchievements: 'asc' },
    });

    const totalUnlocked = unlockedIds.size;

    const currentBadge = [...badges]
      .reverse()
      .find((badge) => badge.requiredAchievements <= totalUnlocked);
      
    const nextBadge = badges.find(
      (badge) => badge.requiredAchievements > totalUnlocked,
    );

    return {
      unlocked_achievements: unlockedAchievements,
      next_available_achievements: nextAvailableAchievements,
      current_badge: currentBadge?.name ?? null,
      next_badge: nextBadge?.name ?? null,
      remaining_to_unlock_next_badge: nextBadge
        ? nextBadge.requiredAchievements - totalUnlocked
        : 0,
    };
  }
}
