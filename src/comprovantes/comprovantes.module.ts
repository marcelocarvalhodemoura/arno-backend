import { Module } from '@nestjs/common';
import { ComprovantesController } from './comprovantes.controller';
import { ComprovantesService } from './comprovantes.service';

@Module({
  controllers: [ComprovantesController],
  providers: [ComprovantesService],
})
export class ComprovantesModule {}
