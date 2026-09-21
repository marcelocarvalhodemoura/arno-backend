import { Body, Controller, Get, HttpCode, HttpStatus, Post, Query } from '@nestjs/common';
import { CurrentUser } from '../shared/auth/current-user.decorator';
import type { AuthPayload } from '../shared/auth/token';
import { MensalidadesService } from './mensalidades.service';

@Controller('api')
export class MensalidadesController {
  constructor(private readonly mensalidades: MensalidadesService) {}

  @Get('mensalidades')
  report(@Query('year') year: string | undefined, @CurrentUser() auth: AuthPayload) {
    return this.mensalidades.report(year, auth.userId);
  }

  @Post('mensalidades/notify')
  @HttpCode(HttpStatus.OK)
  notify(@Body() body: unknown, @CurrentUser() auth: AuthPayload) {
    return this.mensalidades.notify(body, auth.userId);
  }
}
