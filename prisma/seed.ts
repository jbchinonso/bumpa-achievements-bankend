import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// Achievements are grouped so the achievements endpoint can show only the
// next one to unlock per group. Adding a new achievement later is just a
// new row here — no code change needed.
const achievements = [
  // group: purchases
  { name: 'First Purchase', slug: 'first-purchase', group: 'purchases', threshold: 1, order: 1 },
  { name: '5 Purchases', slug: '5-purchases', group: 'purchases', threshold: 5, order: 2 },
  { name: '10 Purchases', slug: '10-purchases', group: 'purchases', threshold: 10, order: 3 },
  { name: '25 Purchases', slug: '25-purchases', group: 'purchases', threshold: 25, order: 4 },
  { name: '50 Purchases', slug: '50-purchases', group: 'purchases', threshold: 50, order: 5 },

  // group: achievements_count
  { name: '5 Achievements', slug: '5-achievements', group: 'achievements_count', threshold: 5, order: 1 },
  { name: '10 Achievements', slug: '10-achievements', group: 'achievements_count', threshold: 10, order: 2 },
  { name: '15 Achievements', slug: '15-achievements', group: 'achievements_count', threshold: 15, order: 3 },
];

// Badges unlock based on the user's total number of unlocked achievements.
const badges = [
  { name: 'Beginner', slug: 'beginner', requiredAchievements: 3, order: 1 },
  { name: 'Intermediate', slug: 'intermediate', requiredAchievements: 8, order: 2 },
  { name: 'Advanced', slug: 'advanced', requiredAchievements: 15, order: 3 },
  { name: 'Expert', slug: 'expert', requiredAchievements: 25, order: 4 },
];

async function main() {
  for (const achievement of achievements) {
    await prisma.achievement.upsert({
      where: { slug: achievement.slug },
      update: achievement,
      create: achievement,
    });
  }

  for (const badge of badges) {
    await prisma.badge.upsert({
      where: { slug: badge.slug },
      update: badge,
      create: badge,
    });
  }

  console.log(`Seeded ${achievements.length} achievements and ${badges.length} badges.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
