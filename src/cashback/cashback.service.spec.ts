import { Test } from '@nestjs/testing';
import { Badge, User } from '@prisma/client';
import { CashbackService } from './cashback.service';
import { PrismaService } from '../prisma/prisma.service';
import { PAYMENT_PROVIDER } from '../common/interfaces/payment-provider.interface';
import { BadgeUnlockedEvent } from '../common/events/badge-unlocked.event';

const fakeUser = {
  id: 'user-1',
  name: 'Test User',
  accountNumber: '0123456789',
  bankCode: '044',
} as User;

const fakeBadge = { id: 'badge-1', name: 'Beginner' } as Badge;

interface UpdateTransactionCall {
  where: { id: string };
  data: Record<string, unknown>;
}

describe('CashbackService', () => {
  let service: CashbackService;
  let paymentProvider: { transfer: jest.Mock };

  function buildPrismaStub(existingTransaction: unknown = null) {
    return {
      badge: { findUniqueOrThrow: jest.fn().mockResolvedValue(fakeBadge) },
      cashbackTransaction: {
        findFirst: jest.fn().mockResolvedValue(existingTransaction),
        create: jest.fn().mockResolvedValue({ id: 'transaction-1' }),
        update: jest.fn().mockResolvedValue(undefined),
      },
      userBadge: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    };
  }

  beforeEach(() => {
    paymentProvider = { transfer: jest.fn() };
  });

  async function buildService(prisma: Record<string, unknown>) {
    const module = await Test.createTestingModule({
      providers: [
        CashbackService,
        { provide: PrismaService, useValue: prisma },
        { provide: PAYMENT_PROVIDER, useValue: paymentProvider },
      ],
    }).compile();

    return module.get(CashbackService);
  }

  it('creates a PENDING transaction, then marks it SUCCESS on a successful transfer', async () => {
    const prisma = buildPrismaStub();
    paymentProvider.transfer.mockResolvedValue({
      success: true,
      reference: 'ref-123',
      raw: { ok: true },
    });
    service = await buildService(prisma);

    await service.processBadgeUnlocked(
      new BadgeUnlockedEvent('Beginner', fakeUser),
    );

    expect(prisma.cashbackTransaction.create).toHaveBeenCalledWith({
      data: {
        userId: fakeUser.id,
        badgeId: fakeBadge.id,
        amount: 30_000,
        status: 'PENDING',
      },
    });
    expect(paymentProvider.transfer).toHaveBeenCalledWith({
      amountKobo: 30_000,
      accountNumber: fakeUser.accountNumber,
      bankCode: fakeUser.bankCode,
      accountName: fakeUser.name,
      reason: 'Cashback for unlocking Beginner badge',
    });
    const [updateArgs] = prisma.cashbackTransaction.update.mock.calls[0] as [
      UpdateTransactionCall,
    ];
    expect(updateArgs.where).toEqual({ id: 'transaction-1' });
    expect(updateArgs.data.status).toBe('SUCCESS');
    expect(updateArgs.data.providerReference).toBe('ref-123');
    expect(prisma.userBadge.updateMany).toHaveBeenCalledWith({
      where: { userId: fakeUser.id, badgeId: fakeBadge.id },
      data: { cashbackStatus: 'SUCCESS', cashbackReference: 'ref-123' },
    });
  });

  it('marks the transaction FAILED and records the reason when the transfer fails', async () => {
    const prisma = buildPrismaStub();
    paymentProvider.transfer.mockResolvedValue({
      success: false,
      failureReason: 'Invalid account number',
    });
    service = await buildService(prisma);

    await service.processBadgeUnlocked(
      new BadgeUnlockedEvent('Beginner', fakeUser),
    );

    const [updateArgs] = prisma.cashbackTransaction.update.mock.calls[0] as [
      UpdateTransactionCall,
    ];
    expect(updateArgs.where).toEqual({ id: 'transaction-1' });
    expect(updateArgs.data.status).toBe('FAILED');
    expect(updateArgs.data.failureReason).toBe('Invalid account number');
    expect(prisma.userBadge.updateMany).toHaveBeenCalledWith({
      where: { userId: fakeUser.id, badgeId: fakeBadge.id },
      data: { cashbackStatus: 'FAILED' },
    });
  });

  it('does not pay twice: skips entirely if a PENDING or SUCCESS transaction already exists for this badge', async () => {
    const prisma = buildPrismaStub({
      id: 'existing-transaction',
      status: 'SUCCESS',
    });
    service = await buildService(prisma);

    await service.processBadgeUnlocked(
      new BadgeUnlockedEvent('Beginner', fakeUser),
    );

    expect(prisma.cashbackTransaction.create).not.toHaveBeenCalled();
    expect(paymentProvider.transfer).not.toHaveBeenCalled();
  });
});
