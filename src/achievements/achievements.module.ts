import { Module } from '@nestjs/common';
import { AchievementsService } from './achievements.service';
import { AchievementsController } from './achievements.controller';
import { AchievementsListener } from './achievements.listener';

@Module({
  controllers: [AchievementsController],
  providers: [AchievementsService, AchievementsListener],
})
export class AchievementsModule {}
