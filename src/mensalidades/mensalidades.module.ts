import { Module } from '@nestjs/common';
import { FeeScheduleController } from './fee-schedule.controller';
import { FeeScheduleService } from './fee-schedule.service';
import { MensalidadesController } from './mensalidades.controller';
import { MensalidadesService } from './mensalidades.service';

@Module({
  controllers: [MensalidadesController, FeeScheduleController],
  providers: [MensalidadesService, FeeScheduleService],
})
export class MensalidadesModule {}
