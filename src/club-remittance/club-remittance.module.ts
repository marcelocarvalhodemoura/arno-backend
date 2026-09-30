import { Module } from '@nestjs/common';
import { ClubRemittanceController } from './club-remittance.controller';
import { ClubRemittanceService } from './club-remittance.service';

@Module({
  controllers: [ClubRemittanceController],
  providers: [ClubRemittanceService],
})
export class ClubRemittanceModule {}
