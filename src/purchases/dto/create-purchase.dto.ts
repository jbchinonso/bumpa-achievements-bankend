import { IsInt, IsOptional, IsString, IsUUID, Min } from 'class-validator';

export class CreatePurchaseDto {
  @IsUUID()
  userId!: string;

  // stored in kobo
  @IsInt()
  @Min(1)
  amount!: number;

  @IsOptional()
  @IsString()
  productId?: string;
}
