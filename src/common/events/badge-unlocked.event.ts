import { User } from '@prisma/client';

// Payload required by the assessment: badge_name (string) + full User model.
export class BadgeUnlockedEvent {
  constructor(
    public readonly badge_name: string,
    public readonly user: User,
  ) {}
}
