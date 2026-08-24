import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../prisma/prisma.service';
import { UsersService } from '../users/users.service';
import { CreatePurchaseDto } from './dto/create-purchase.dto';
import { AppEvents } from '../common/events/app-events';
import { PurchaseMadeEvent } from '../common/events/purchase-made.event';

@Injectable()
export class PurchasesService {
  private readonly logger = new Logger(PurchasesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly usersService: UsersService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  async create(dto: CreatePurchaseDto) {
    // Throws NotFoundException if the user doesn't exist.
    await this.usersService.findById(dto.userId);

    const purchase = await this.prisma.purchase.create({ data: dto });
    this.logger.log(
      `Purchase recorded: id=${purchase.id} user=${dto.userId} amount=${dto.amount}`,
    );

    // emitAsync waits for listeners (achievement unlocking) to finish,
    // so the response reflects the fully settled state.
    await this.eventEmitter.emitAsync(
      AppEvents.PURCHASE_MADE,
      new PurchaseMadeEvent(dto.userId),
    );

    return purchase;
  }

  findAllForUser(userId: string) {
    return this.prisma.purchase.findMany({
      where: { userId },
      orderBy: { createdAt: 'asc' },
    });
  }
}
