import { Module } from '@nestjs/common';
import { BankingController } from './banking.controller';
import { BankingService } from './banking.service';
import { OpenFinanceController } from './openfinance.controller';
import { OpenFinanceService } from './openfinance.service';

@Module({
  controllers: [BankingController, OpenFinanceController],
  providers: [BankingService, OpenFinanceService],
})
export class BankingModule {}
