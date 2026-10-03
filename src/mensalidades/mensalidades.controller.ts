import { Body, Controller, Get, HttpCode, HttpStatus, Param, Patch, Post, Query } from '@nestjs/common';
import { Roles } from '../shared/auth/roles.decorator';
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
    description:
      'Devolve a grade do ano. Anos que já têm cobranças são sincronizados; anos sem cobranças voltam com generated=false e não geram nada.',
  })
  @ApiQuery({ name: 'year', required: false, example: '2026' })
  report(@Query('year') year: string | undefined, @CurrentUser() auth: AuthPayload) {
    return this.mensalidades.report(year, auth.userId);
  }

  @Get('next-steps')
  @ApiOperation({ summary: 'Próximos passos da tesouraria (pendências do dia)' })
  nextSteps() {
    return this.mensalidades.nextSteps();
  }

  @Get('members/:id/profile')
  @ApiOperation({ summary: 'Ficha do associado: em aberto, acordos, pagos e últimos lançamentos' })
  memberProfile(@Param('id') id: string) {
    return this.mensalidades.memberProfile(id);
  }

  @Get('reports/assembly')
  @Roles('admin')
  @ApiOperation({ summary: 'Prestação de contas do período (assembleia / conselho fiscal)' })
  @ApiQuery({ name: 'from', required: true, example: '2026-01-01' })
  @ApiQuery({ name: 'to', required: true, example: '2026-06-30' })
  assembly(@Query('from') from?: string, @Query('to') to?: string) {
    return this.mensalidades.assembly(from, to);
  }

  @Get('reports/delinquency')
  @Roles('admin')
  @ApiOperation({ summary: 'Inadimplência de mensalidades por associado no período' })
  @ApiQuery({ name: 'from', required: true, example: '2026-03-01' })
  @ApiQuery({ name: 'to', required: true, example: '2026-11-30' })
  delinquency(@Query('from') from?: string, @Query('to') to?: string) {
    return this.mensalidades.delinquency(from, to);
  }

  @Get('reconciliation')
  @ApiOperation({
    summary: 'Sugestões de conciliação',
    description: 'Para cada crédito pago ainda sem tipo, a mensalidade pendente que ele provavelmente quita.',
  })
  @ApiQuery({ name: 'from', required: false, example: '2026-07-01' })
  @ApiQuery({ name: 'to', required: false, example: '2026-09-30' })
  reconciliation(@Query('from') from?: string, @Query('to') to?: string) {
    return this.mensalidades.reconciliation(from, to);
  }

  @Post('reconciliation/confirm')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Confirmar sugestão: o crédito vira a mensalidade do mês' })
  confirmReconciliation(@Body() body: unknown, @CurrentUser() auth: AuthPayload) {
    return this.mensalidades.confirmReconciliation(body, auth.userId);
  }

  @Post('reconciliation/dismiss')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Recusar sugestão de conciliação' })
  dismissReconciliation(@Body() body: unknown, @CurrentUser() auth: AuthPayload) {
    return this.mensalidades.dismissReconciliation(body, auth.userId);
  }

  @Post('mensalidades/generate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Gerar as cobranças do ano',
    description: 'Cria as mensalidades pendentes (março a novembro) dos associados ativos. Ver a grade não gera nada.',
  })
  @ApiBody({ schema: { type: 'object', required: ['year'], properties: { year: { type: 'number', example: 2027 } } } })
  generate(@Body() body: unknown, @CurrentUser() auth: AuthPayload) {
    return this.mensalidades.generate(body, auth.userId);
  }

  @Get('mensalidades/open')
  @ApiOperation({
    summary: 'Mensalidades em aberto do associado',
    description:
      'Lista as cobranças pendentes ou vencidas que já existem (qualquer ano). Somente leitura: não gera a grade do ano.',
  })
  @ApiQuery({ name: 'memberId', required: true })
  open(@Query('memberId') memberId: string | undefined) {
    return this.mensalidades.open(memberId);
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
      required: ['timing'],
      properties: {
        transactionId: { type: 'string' },
        transactionIds: { type: 'array', items: { type: 'string' }, description: 'Várias mensalidades (ex.: irmãos)' },
        timing: { type: 'string', enum: ['on_time', 'late'] },
        paidAt: { type: 'string', example: '2026-09-08', nullable: true },
        notifyReceipt: { type: 'boolean', example: true },
      },
    },
  })
  settle(@Body() body: unknown, @CurrentUser() auth: AuthPayload) {
    return this.mensalidades.settle(body, auth.userId);
  }

  @Post('mensalidades/allocate-preview')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Prévia do rateio de mensalidades a partir de um Pix',
    description: 'Calcula o valor de cada competência (pontual ou atraso). A soma deve bater com o crédito do extrato.',
  })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['memberId', 'timing', 'yearMonths'],
      properties: {
        memberId: { type: 'string' },
        timing: { type: 'string', enum: ['on_time', 'late'] },
        yearMonths: {
          type: 'array',
          items: { type: 'string', example: '2026-03' },
          minItems: 2,
        },
      },
    },
  })
  allocatePreview(@Body() body: unknown) {
    return this.mensalidades.allocatePreview(body);
  }

  @Post('mensalidades/allocate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Ratear Pix pago em várias mensalidades',
    description:
      'Converte um crédito já pago do extrato em partes de mensalidade por competência. O usuário escolhe pontual ou atraso; paidAt é a data do Pix.',
  })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['transactionId', 'memberId', 'timing', 'yearMonths'],
      properties: {
        transactionId: { type: 'string' },
        memberId: { type: 'string' },
        timing: { type: 'string', enum: ['on_time', 'late'] },
        yearMonths: {
          type: 'array',
          items: { type: 'string', example: '2026-03' },
          minItems: 2,
        },
        paidAt: { type: 'string', example: '2026-01-11', nullable: true },
        notifyReceipt: { type: 'boolean', example: true },
      },
    },
  })
  allocate(@Body() body: unknown, @CurrentUser() auth: AuthPayload) {
    return this.mensalidades.allocate(body, auth.userId);
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
