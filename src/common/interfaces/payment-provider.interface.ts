export interface TransferPayload {
  amountKobo: number;
  accountNumber: string;
  bankCode: string;
  accountName: string;
  reason: string;
}

export interface TransferResult {
  success: boolean;
  reference?: string;
  failureReason?: string;
  raw?: unknown;
}

export interface PaymentProvider {
  transfer(payload: TransferPayload): Promise<TransferResult>;
}

// Interfaces don't exist at runtime, so DI needs a token to look up the
// bound implementation by.
export const PAYMENT_PROVIDER = 'PAYMENT_PROVIDER';
