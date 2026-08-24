import { User } from '@prisma/client';

// Payload required by the assessment: achievement_name (string) + full User model.
export class AchievementUnlockedEvent {
  constructor(
    public readonly achievement_name: string,
    public readonly user: User,
  ) {}
}
