import { Module } from '@nestjs/common';
import { CashbackService } from './cashback.service';
import { CashbackListener } from './cashback.listener';
import { PaystackProvider } from './providers/paystack.provider';
import { PAYMENT_PROVIDER } from '../common/interfaces/payment-provider.interface';

@Module({
  providers: [
    CashbackService,
    CashbackListener,
    { provide: PAYMENT_PROVIDER, useClass: PaystackProvider },
  ],
})
export class CashbackModule {}
