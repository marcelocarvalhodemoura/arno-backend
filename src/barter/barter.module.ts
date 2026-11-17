import { Module } from '@nestjs/common';
import { BarterController } from './barter.controller';
import { BarterService } from './barter.service';

@Module({
  controllers: [BarterController],
  providers: [BarterService],
})
export class BarterModule {}
