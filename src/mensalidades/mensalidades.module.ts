import { Module } from '@nestjs/common';
import { MensalidadesController } from './mensalidades.controller';
import { MensalidadesService } from './mensalidades.service';

@Module({
  controllers: [MensalidadesController],
  providers: [MensalidadesService],
})
export class MensalidadesModule {}
