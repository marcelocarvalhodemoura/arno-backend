import { Body, Controller, Get, HttpCode, HttpStatus, Param, Patch, Post } from '@nestjs/common';
import { ApiBody, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../shared/auth/current-user.decorator';
import type { AuthPayload } from '../shared/auth/token';
import { ApiAuth } from '../shared/swagger/api-auth.decorator';
import { ArrearsService } from './arrears.service';

@ApiTags('Dívidas')
@ApiAuth()
@Controller('api')
export class ArrearsController {
  constructor(private readonly arrears: ArrearsService) {}

  @Get('arrears')
  @ApiOperation({ summary: 'Listar acordos de dívida diluída' })
  list(@CurrentUser() auth: AuthPayload) {
    return this.arrears.list(auth.userId);
  }

  @Get('arrears/:id')
  @ApiOperation({ summary: 'Detalhe do acordo com progresso e histórico de pagamentos' })
  get(@Param('id') id: string) {
    return this.arrears.get(id);
  }

  @Post('arrears')
  @ApiOperation({
    summary: 'Criar acordo de dívida diluída',
    description:
      'chargeMode=embed embute a parcela na mensalidade; separate gera lançamentos à parte. startYearMonth = primeira competência (YYYY-MM).',
  })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['memberId', 'amount', 'installments', 'startYearMonth', 'chargeMode'],
      properties: {
        memberId: { type: 'string' },
        amount: { type: 'number', example: 360 },
        installments: { type: 'integer', example: 6, minimum: 2, maximum: 12 },
        startYearMonth: { type: 'string', example: '2026-03' },
        chargeMode: { type: 'string', enum: ['embed', 'separate'] },
        note: { type: 'string' },
      },
    },
  })
  create(@Body() body: unknown, @CurrentUser() auth: AuthPayload) {
    return this.arrears.create(body, auth.userId);
  }

  @Post('arrears/:id/payments')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Registrar pagamento (parcial, adiantamento ou quitação)',
    description:
      'Lança entrada no fluxo, reduz o saldo e recalcula parcelas restantes. No modo embutido, atualiza mensalidades pendentes.',
  })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['amount'],
      properties: {
        amount: { type: 'number', example: 100 },
        paidAt: { type: 'string', example: '2026-04-15' },
        method: { type: 'string', enum: ['pix', 'cash', 'transfer', 'card', 'other'] },
        note: { type: 'string' },
      },
    },
  })
  pay(@Param('id') id: string, @Body() body: unknown, @CurrentUser() auth: AuthPayload) {
    return this.arrears.pay(id, body, auth.userId);
  }

  @Patch('arrears/:id/cancel')
  @ApiOperation({ summary: 'Cancelar acordo ativo' })
  cancel(@Param('id') id: string, @CurrentUser() auth: AuthPayload) {
    return this.arrears.cancel(id, auth.userId);
  }

  @Patch('arrears/:id/settle')
  @ApiOperation({
    summary: 'Quitar acordo (por padrão registra o saldo restante no fluxo)',
    description: 'Use recordPayment=false para apenas zerar o acordo sem lançar entrada.',
  })
  @ApiBody({
    required: false,
    schema: {
      type: 'object',
      properties: {
        recordPayment: { type: 'boolean', default: true },
        paidAt: { type: 'string', example: '2026-04-15' },
        method: { type: 'string', enum: ['pix', 'cash', 'transfer', 'card', 'other'] },
        note: { type: 'string' },
      },
    },
  })
  settle(@Param('id') id: string, @Body() body: unknown, @CurrentUser() auth: AuthPayload) {
    return this.arrears.settle(id, body, auth.userId);
  }

  @Post('arrears/:id/generate-month')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Gerar lançamento de uma competência (modo separate)',
  })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['yearMonth'],
      properties: { yearMonth: { type: 'string', example: '2026-04' } },
    },
  })
  generateMonth(@Param('id') id: string, @Body() body: unknown, @CurrentUser() auth: AuthPayload) {
    return this.arrears.generateMonth(id, body, auth.userId);
  }

  @Post('arrears/:id/generate-due')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Gerar parcelas vencidas até monthLimit (retroativo; modo separate)',
    description: 'Não sobrescreve competências que já tenham lançamento (pago ou pendente).',
  })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['monthLimit'],
      properties: { monthLimit: { type: 'string', example: '2026-09' } },
    },
  })
  generateDue(@Param('id') id: string, @Body() body: unknown, @CurrentUser() auth: AuthPayload) {
    return this.arrears.generateDue(id, body, auth.userId);
  }
}
