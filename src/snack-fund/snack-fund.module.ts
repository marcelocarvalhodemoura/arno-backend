import { Module } from '@nestjs/common';
import { SnackFundController } from './snack-fund.controller';
import { SnackFundService } from './snack-fund.service';

@Module({
  controllers: [SnackFundController],
  providers: [SnackFundService],
})
export class SnackFundModule {}
