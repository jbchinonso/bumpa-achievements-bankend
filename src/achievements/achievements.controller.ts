import { Controller, Get, Param, ParseUUIDPipe } from '@nestjs/common';
import { AchievementsService } from './achievements.service';

@Controller()
export class AchievementsController {
  constructor(private readonly achievementsService: AchievementsService) {}

  @Get('achievements')
  findAll() {
    return this.achievementsService.findAll();
  }

  @Get('users/:userId/achievements')
  getUserAchievements(@Param('userId', ParseUUIDPipe) userId: string) {
    return this.achievementsService.getUserAchievementsSummary(userId);
  }
}
