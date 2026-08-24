import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../prisma/prisma.service';
import { AppEvents } from '../common/events/app-events';
import { BadgeUnlockedEvent } from '../common/events/badge-unlocked.event';

@Injectable()
export class BadgesService {
  private readonly logger = new Logger(BadgesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  findAll() {
    return this.prisma.badge.findMany({ orderBy: { order: 'asc' } });
  }

  // Unlocks every badge the user newly qualifies for, based on their total
  // number of unlocked achievements.
  async evaluateAndUnlock(userId: string): Promise<void> {
    const achievementCount = await this.prisma.userAchievement.count({
      where: { userId },
    });

    const badges = await this.findAll();
    const unlockedBadges = await this.prisma.userBadge.findMany({
      where: { userId },
      select: { badgeId: true },
    });
    const unlockedIds = new Set(
      unlockedBadges.map((unlocked) => unlocked.badgeId),
    );

    const toUnlock = badges.filter(
      (badge) =>
        !unlockedIds.has(badge.id) &&
        badge.requiredAchievements <= achievementCount,
    );

    if (toUnlock.length === 0) return;

    await this.prisma.userBadge.createMany({
      data: toUnlock.map((badge) => ({ userId, badgeId: badge.id })),
      skipDuplicates: true,
    });

    // badges is ordered ascending, so the last unlocked entry is the
    // highest tier the user has now reached.
    const highestNewBadge = toUnlock[toUnlock.length - 1];
    await this.prisma.user.update({
      where: { id: userId },
      data: { currentBadgeId: highestNewBadge.id },
    });

    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
    });

    for (const badge of toUnlock) {
      this.logger.log(`Badge unlocked: "${badge.name}" user=${userId}`);
      await this.eventEmitter.emitAsync(
        AppEvents.BADGE_UNLOCKED,
        new BadgeUnlockedEvent(badge.name, user),
      );
    }
  }
}
