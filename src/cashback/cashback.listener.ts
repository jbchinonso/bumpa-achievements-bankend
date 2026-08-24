import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { CashbackService } from './cashback.service';
import { AppEvents } from '../common/events/app-events';
import { BadgeUnlockedEvent } from '../common/events/badge-unlocked.event';

@Injectable()
export class CashbackListener {
  constructor(private readonly cashbackService: CashbackService) {}

  @OnEvent(AppEvents.BADGE_UNLOCKED)
  async handleBadgeUnlocked(event: BadgeUnlockedEvent) {
    await this.cashbackService.processBadgeUnlocked(event);
  }
}
