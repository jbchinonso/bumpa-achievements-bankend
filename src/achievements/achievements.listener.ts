import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { AchievementsService } from './achievements.service';
import { AppEvents } from '../common/events/app-events';
import { PurchaseMadeEvent } from '../common/events/purchase-made.event';

@Injectable()
export class AchievementsListener {
  constructor(private readonly achievementsService: AchievementsService) {}

  @OnEvent(AppEvents.PURCHASE_MADE)
  async handlePurchaseMade(event: PurchaseMadeEvent) {
    await this.achievementsService.evaluateAndUnlock(event.userId);
  }
}
