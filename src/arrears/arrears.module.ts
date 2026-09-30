import { Module } from '@nestjs/common';
import { ArrearsController } from './arrears.controller';
import { ArrearsService } from './arrears.service';

@Module({
  controllers: [ArrearsController],
  providers: [ArrearsService],
})
export class ArrearsModule {}
