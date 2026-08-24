import { Module } from '@nestjs/common';
import { BadgesService } from './badges.service';
import { BadgesController } from './badges.controller';
import { BadgesListener } from './badges.listener';

@Module({
  controllers: [BadgesController],
  providers: [BadgesService, BadgesListener],
})
export class BadgesModule {}
