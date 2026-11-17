import { Module } from '@nestjs/common';
import { BranchLedgerController } from './branch-ledger.controller';
import { BranchLedgerService } from './branch-ledger.service';

@Module({
  controllers: [BranchLedgerController],
  providers: [BranchLedgerService],
})
export class BranchLedgerModule {}
