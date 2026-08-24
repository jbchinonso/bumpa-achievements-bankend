import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './prisma/prisma.module';
import { UsersModule } from './users/users.module';
import { PurchasesModule } from './purchases/purchases.module';
import { AchievementsModule } from './achievements/achievements.module';
import { BadgesModule } from './badges/badges.module';
import { CashbackModule } from './cashback/cashback.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    EventEmitterModule.forRoot(),
    PrismaModule,
    UsersModule,
    PurchasesModule,
    AchievementsModule,
    BadgesModule,
    CashbackModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
