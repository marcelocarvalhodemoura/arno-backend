import { Module } from '@nestjs/common';
import { TRANSACTION_REPOSITORY } from './domain/transaction.repository';
import { PrismaTransactionRepository } from './infra/prisma-transaction.repository';
import { LedgerController } from './ledger.controller';
import { LedgerService } from './ledger.service';

@Module({
  controllers: [LedgerController],
  providers: [LedgerService, { provide: TRANSACTION_REPOSITORY, useClass: PrismaTransactionRepository }],
  exports: [TRANSACTION_REPOSITORY],
})
export class LedgerModule {}
