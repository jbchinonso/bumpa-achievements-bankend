import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import helmet from 'helmet';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { PAYMENT_PROVIDER } from '../src/common/interfaces/payment-provider.interface';
import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter';

// Achievement/badge summary shape returned by GET /users/:userId/achievements.
interface AchievementsSummary {
  unlocked_achievements: string[];
  next_available_achievements: string[];
  current_badge: string | null;
  next_badge: string | null;
  remaining_to_unlock_next_badge: number;
}

async function resetUserData(prisma: PrismaService) {
  // Wipes everything a user can generate, but leaves the seeded
  // achievements/badges catalog in place.
  await prisma.cashbackTransaction.deleteMany();
  await prisma.userBadge.deleteMany();
  await prisma.userAchievement.deleteMany();
  await prisma.purchase.deleteMany();
  await prisma.user.deleteMany();
}

describe('Achievements flow (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let paymentProvider: { transfer: jest.Mock };

  beforeAll(async () => {
    paymentProvider = { transfer: jest.fn() };

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PAYMENT_PROVIDER)
      .useValue(paymentProvider)
      .compile();

    app = moduleFixture.createNestApplication();
    app.use(helmet());
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true }),
    );
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();

    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    // Cashback transfers succeed by default; individual tests override this.
    paymentProvider.transfer.mockReset().mockResolvedValue({
      success: true,
      reference: `mock-${Date.now()}`,
      raw: { mock: true },
    });
    await resetUserData(prisma);
  });

  async function createUser() {
    const response = await request(app.getHttpServer())
      .post('/users')
      .send({
        email: `user-${Date.now()}-${Math.random()}@example.com`,
        name: 'Test User',
        accountNumber: '0123456789',
        bankCode: '044',
      })
      .expect(201);
    return response.body as { id: string };
  }

  async function purchase(userId: string) {
    return request(app.getHttpServer())
      .post('/purchases')
      .send({ userId, amount: 1000 })
      .expect(201);
  }

  async function purchaseTimes(userId: string, times: number) {
    for (let i = 0; i < times; i++) {
      await purchase(userId);
    }
  }

  async function getAchievements(userId: string) {
    const response = await request(app.getHttpServer())
      .get(`/users/${userId}/achievements`)
      .expect(200);
    return response.body as AchievementsSummary;
  }

  describe('full purchase -> achievement -> badge -> cashback journey', () => {
    it('unlocks achievements/badges in the right order and pays cashback on each badge', async () => {
      const user = await createUser();

      await purchaseTimes(user.id, 10);
      let summary = await getAchievements(user.id);
      expect(summary).toEqual({
        unlocked_achievements: [
          'First Purchase',
          '5 Purchases',
          '10 Purchases',
          '3 Achievements',
        ],
        next_available_achievements: ['5 Achievements', '25 Purchases'],
        current_badge: 'Beginner',
        next_badge: 'Intermediate',
        remaining_to_unlock_next_badge: 1,
      });

      await purchaseTimes(user.id, 15); // total: 25
      summary = await getAchievements(user.id);
      expect(summary.current_badge).toBe('Intermediate');
      expect(summary.next_badge).toBe('Advanced');
      expect(summary.remaining_to_unlock_next_badge).toBe(2);

      await purchaseTimes(user.id, 25); // total: 50
      summary = await getAchievements(user.id);
      expect(summary).toEqual({
        unlocked_achievements: [
          'First Purchase',
          '5 Purchases',
          '10 Purchases',
          '3 Achievements',
          '25 Purchases',
          '5 Achievements',
          '50 Purchases',
          '7 Achievements',
        ],
        next_available_achievements: [],
        current_badge: 'Advanced',
        next_badge: null,
        remaining_to_unlock_next_badge: 0,
      });

      // One cashback transaction per badge (Beginner, Intermediate, Advanced),
      // all successful since the mock provider always succeeds here.
      const transactions = await prisma.cashbackTransaction.findMany({
        where: { userId: user.id },
      });
      expect(transactions).toHaveLength(3);
      expect(transactions.every((t) => t.status === 'SUCCESS')).toBe(true);
    });

    it('does not unlock anything extra beyond purchase #50 and never double-pays a badge', async () => {
      const user = await createUser();

      await purchaseTimes(user.id, 55);
      const summary = await getAchievements(user.id);
      expect(summary.unlocked_achievements).toHaveLength(8);
      expect(summary.current_badge).toBe('Advanced');

      const transactions = await prisma.cashbackTransaction.findMany({
        where: { userId: user.id },
      });
      expect(transactions).toHaveLength(3);
    });
  });

  describe('GET /users/:userId/achievements at various states', () => {
    it('reports a clean starting state for a fresh user with no purchases', async () => {
      const user = await createUser();

      const summary = await getAchievements(user.id);

      expect(summary).toEqual({
        unlocked_achievements: [],
        next_available_achievements: ['3 Achievements', 'First Purchase'],
        current_badge: null,
        next_badge: 'Beginner',
        remaining_to_unlock_next_badge: 3,
      });
    });

    it('returns 404 for a user that does not exist', async () => {
      await request(app.getHttpServer())
        .get('/users/00000000-0000-0000-0000-000000000000/achievements')
        .expect(404);
    });

    it('returns 400 for a malformed userId', async () => {
      await request(app.getHttpServer())
        .get('/users/not-a-uuid/achievements')
        .expect(400);
    });
  });

  describe('validation errors', () => {
    it('rejects a purchase with a non-positive amount', async () => {
      const user = await createUser();

      await request(app.getHttpServer())
        .post('/purchases')
        .send({ userId: user.id, amount: 0 })
        .expect(400);
    });

    it('rejects a purchase for a user that does not exist', async () => {
      await request(app.getHttpServer())
        .post('/purchases')
        .send({
          userId: '00000000-0000-0000-0000-000000000000',
          amount: 1000,
        })
        .expect(404);
    });

    it('rejects user creation with an invalid email', async () => {
      await request(app.getHttpServer())
        .post('/users')
        .send({
          email: 'not-an-email',
          name: 'Test User',
          accountNumber: '0123456789',
          bankCode: '044',
        })
        .expect(400);
    });
  });

  describe('cashback failure handling', () => {
    it('records a FAILED cashback transaction without breaking the purchase request', async () => {
      paymentProvider.transfer.mockResolvedValue({
        success: false,
        failureReason: 'Invalid account number',
      });
      const user = await createUser();

      await purchaseTimes(user.id, 10); // crosses the Beginner threshold

      const summary = await getAchievements(user.id);
      expect(summary.current_badge).toBe('Beginner');

      const transaction = await prisma.cashbackTransaction.findFirst({
        where: { userId: user.id },
      });
      expect(transaction?.status).toBe('FAILED');
      expect(transaction?.failureReason).toBe('Invalid account number');

      const userBadge = await prisma.userBadge.findFirst({
        where: { userId: user.id },
      });
      expect(userBadge?.cashbackStatus).toBe('FAILED');
    });
  });
});
