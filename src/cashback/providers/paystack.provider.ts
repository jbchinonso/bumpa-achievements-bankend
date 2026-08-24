import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import {
  PaymentProvider,
  TransferPayload,
  TransferResult,
} from '../../common/interfaces/payment-provider.interface';

const PAYSTACK_BASE_URL = 'https://api.paystack.co';

interface CreateRecipientResponse {
  data: { recipient_code: string };
}

interface InitiateTransferResponse {
  data: { reference: string };
}

@Injectable()
export class PaystackProvider implements PaymentProvider {
  constructor(private readonly configService: ConfigService) {}

  async transfer(payload: TransferPayload): Promise<TransferResult> {
    const secretKey = this.configService.get<string>('PAYSTACK_SECRET_KEY');
    const headers = { Authorization: `Bearer ${secretKey}` };

    try {
      const recipient = await axios.post<CreateRecipientResponse>(
        `${PAYSTACK_BASE_URL}/transferrecipient`,
        {
          type: 'nuban',
          name: payload.accountName,
          account_number: payload.accountNumber,
          bank_code: payload.bankCode,
          currency: 'NGN',
        },
        { headers },
      );
      const recipientCode = recipient.data.data.recipient_code;

      const transfer = await axios.post<InitiateTransferResponse>(
        `${PAYSTACK_BASE_URL}/transfer`,
        {
          source: 'balance',
          amount: payload.amountKobo,
          recipient: recipientCode,
          reason: payload.reason,
        },
        { headers },
      );

      return {
        success: true,
        reference: transfer.data.data.reference,
        raw: transfer.data,
      };
    } catch (error) {
      return {
        success: false,
        failureReason: this.extractFailureReason(error),
        raw: axios.isAxiosError(error) ? error.response?.data : undefined,
      };
    }
  }

  private extractFailureReason(error: unknown): string {
    if (axios.isAxiosError(error)) {
      return (
        (error.response?.data as { message?: string } | undefined)?.message ??
        error.message
      );
    }
    return 'Unknown error';
  }
}
