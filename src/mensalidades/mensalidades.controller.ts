import { Body, Controller, Get, HttpCode, HttpStatus, Post, Query } from '@nestjs/common';
import { ApiBody, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../shared/auth/current-user.decorator';
import type { AuthPayload } from '../shared/auth/token';
import { ApiAuth } from '../shared/swagger/api-auth.decorator';
import { MensalidadesService } from './mensalidades.service';

@ApiTags('Mensalidades')
@ApiAuth()
@Controller('api')
export class MensalidadesController {
  constructor(private readonly mensalidades: MensalidadesService) {}

  @Get('mensalidades')
  @ApiOperation({
    summary: 'Grade de mensalidades',
    description: 'Sincroniza o ano (mar–dez) e devolve a grade com status paid | pending | overdue | none.',
  })
  @ApiQuery({ name: 'year', required: false, example: '2026' })
  report(@Query('year') year: string | undefined, @CurrentUser() auth: AuthPayload) {
    return this.mensalidades.report(year, auth.userId);
  }

  @Post('mensalidades/notify')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Disparar cobrança ou comprovante',
    description: 'kind: charge | receipt. Canais: email | whatsapp. Sem channels, usa o que estiver configurado.',
  })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        year: { type: 'integer', example: 2026 },
        month: { type: 'integer', example: 4 },
        kind: { type: 'string', enum: ['charge', 'receipt'] },
        memberIds: { type: 'array', items: { type: 'string' } },
        transactionIds: { type: 'array', items: { type: 'string' } },
        channels: {
          type: 'array',
          items: { type: 'string', enum: ['email', 'whatsapp'] },
        },
      },
    },
  })
  notify(@Body() body: unknown, @CurrentUser() auth: AuthPayload) {
    return this.mensalidades.notify(body, auth.userId);
  }
}
