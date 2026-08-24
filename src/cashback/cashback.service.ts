import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PAYMENT_PROVIDER } from '../common/interfaces/payment-provider.interface';
import type { PaymentProvider } from '../common/interfaces/payment-provider.interface';
import { BadgeUnlockedEvent } from '../common/events/badge-unlocked.event';

const CASHBACK_AMOUNT_KOBO = 30_000; // 300 Naira

@Injectable()
export class CashbackService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(PAYMENT_PROVIDER)
    private readonly paymentProvider: PaymentProvider,
  ) {}

  async processBadgeUnlocked(event: BadgeUnlockedEvent): Promise<void> {
    const badge = await this.prisma.badge.findUniqueOrThrow({
      where: { name: event.badge_name },
    });

    // Idempotency: don't pay twice for the same badge if this ever runs
    // more than once for the same user/badge.
    const existing = await this.prisma.cashbackTransaction.findFirst({
      where: {
        userId: event.user.id,
        badgeId: badge.id,
        status: { in: ['PENDING', 'SUCCESS'] },
      },
    });
    if (existing) return;

    const transaction = await this.prisma.cashbackTransaction.create({
      data: {
        userId: event.user.id,
        badgeId: badge.id,
        amount: CASHBACK_AMOUNT_KOBO,
        status: 'PENDING',
      },
    });

    const result = await this.paymentProvider.transfer({
      amountKobo: CASHBACK_AMOUNT_KOBO,
      accountNumber: event.user.accountNumber,
      bankCode: event.user.bankCode,
      accountName: event.user.name,
      reason: `Cashback for unlocking ${event.badge_name} badge`,
    });

    if (result.success) {
      await this.prisma.cashbackTransaction.update({
        where: { id: transaction.id },
        data: {
          status: 'SUCCESS',
          providerReference: result.reference,
          providerResponse: result.raw as object,
          completedAt: new Date(),
        },
      });
      await this.prisma.userBadge.updateMany({
        where: { userId: event.user.id, badgeId: badge.id },
        data: {
          cashbackStatus: 'SUCCESS',
          cashbackReference: result.reference,
        },
      });
    } else {
      await this.prisma.cashbackTransaction.update({
        where: { id: transaction.id },
        data: {
          status: 'FAILED',
          failureReason: result.failureReason,
          providerResponse: result.raw as object,
        },
      });
      await this.prisma.userBadge.updateMany({
        where: { userId: event.user.id, badgeId: badge.id },
        data: { cashbackStatus: 'FAILED' },
      });
    }
  }
}
