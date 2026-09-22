import { Body, Controller, Get, HttpCode, HttpStatus, Patch, Post, Query } from '@nestjs/common';
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
    description: 'Sincroniza o ano (mar–nov) e devolve a grade com status paid | pending | overdue | none.',
  })
  @ApiQuery({ name: 'year', required: false, example: '2026' })
  report(@Query('year') year: string | undefined, @CurrentUser() auth: AuthPayload) {
    return this.mensalidades.report(year, auth.userId);
  }

  @Patch('mensalidades/settle')
  @ApiOperation({
    summary: 'Registrar pagamento de mensalidade',
    description:
      'timing=on_time grava o valor pontual; timing=late grava o valor com atraso. paidAt é a data do pagamento (retroativo).',
  })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['transactionId', 'timing'],
      properties: {
        transactionId: { type: 'string' },
        timing: { type: 'string', enum: ['on_time', 'late'] },
        paidAt: { type: 'string', example: '2026-09-08', nullable: true },
        notifyReceipt: { type: 'boolean', example: true },
      },
    },
  })
  settle(@Body() body: unknown, @CurrentUser() auth: AuthPayload) {
    return this.mensalidades.settle(body, auth.userId);
  }

  @Patch('mensalidades/club-fee')
  @ApiOperation({
    summary: 'Incluir ou remover a taxa do clube em uma mensalidade',
    description:
      'Altera só lançamentos pendentes. clubFeeIncluded=true inclui a parcela do clube (R$ 20, exceto pioneiros).',
  })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['transactionId', 'clubFeeIncluded'],
      properties: {
        transactionId: { type: 'string' },
        clubFeeIncluded: { type: 'boolean' },
      },
    },
  })
  setClubFee(@Body() body: unknown, @CurrentUser() auth: AuthPayload) {
    return this.mensalidades.setClubFee(body, auth.userId);
  }

  @Post('mensalidades/club-fee/bulk')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Incluir ou remover a taxa do clube em massa',
    description:
      'Aplica a todos os mensalistas com lançamento pendente no ano. Informe month (3–11) para limitar a um mês.',
  })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['year', 'clubFeeIncluded'],
      properties: {
        year: { type: 'integer', example: 2026 },
        month: { type: 'integer', example: 4 },
        clubFeeIncluded: { type: 'boolean' },
      },
    },
  })
  setClubFeeBulk(@Body() body: unknown, @CurrentUser() auth: AuthPayload) {
    return this.mensalidades.setClubFeeBulk(body, auth.userId);
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
