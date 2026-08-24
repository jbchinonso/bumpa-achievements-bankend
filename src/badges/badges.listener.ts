import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { BadgesService } from './badges.service';
import { AppEvents } from '../common/events/app-events';
import { AchievementUnlockedEvent } from '../common/events/achievement-unlocked.event';

@Injectable()
export class BadgesListener {
  constructor(private readonly badgesService: BadgesService) {}

  @OnEvent(AppEvents.ACHIEVEMENT_UNLOCKED)
  async handleAchievementUnlocked(event: AchievementUnlockedEvent) {
    await this.badgesService.evaluateAndUnlock(event.user.id);
  }
}
