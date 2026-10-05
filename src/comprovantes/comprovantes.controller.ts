import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';
import { ApiBody, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../shared/auth/current-user.decorator';
import type { AuthPayload } from '../shared/auth/token';
import { ApiAuth } from '../shared/swagger/api-auth.decorator';
import { ComprovantesService } from './comprovantes.service';

@ApiTags('Comprovantes')
@ApiAuth()
@Controller('api/comprovantes')
export class ComprovantesController {
  constructor(private readonly comprovantes: ComprovantesService) {}

  @Get()
  @ApiOperation({
    summary: 'Comprovantes recebidos pelo WhatsApp',
    description: 'status: waiting, matched, already, review, rejected, discarded (vários separados por vírgula).',
  })
  @ApiQuery({ name: 'status', required: false, example: 'review,waiting' })
  list(@Query('status') status?: string) {
    return this.comprovantes.list(status);
  }

  @Get('resumo')
  @ApiOperation({ summary: 'Quantos comprovantes estão em revisão ou aguardando o extrato' })
  summary() {
    return this.comprovantes.summary();
  }

  @Post('reprocessar')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Conciliar de novo os comprovantes que aguardam o crédito no extrato' })
  retry(@CurrentUser() auth: AuthPayload) {
    return this.comprovantes.retry(auth.userId);
  }

  @Get(':id/candidatos')
  @ApiOperation({ summary: 'Créditos prováveis e mensalidades em aberto para conferir o comprovante' })
  candidates(@Param('id') id: string) {
    return this.comprovantes.candidates(id);
  }

  @Get(':id/arquivo')
  @ApiOperation({ summary: 'Link temporário do arquivo do comprovante' })
  file(@Param('id') id: string) {
    return this.comprovantes.fileUrl(id);
  }

  @Post(':id/confirmar')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Confirmar: o crédito do extrato vira a mensalidade do associado' })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['creditId', 'pendingId'],
      properties: { creditId: { type: 'string' }, pendingId: { type: 'string' } },
    },
  })
  confirm(@Param('id') id: string, @Body() body: unknown, @CurrentUser() auth: AuthPayload) {
    return this.comprovantes.confirm(id, body, auth.userId);
  }

  @Post(':id/descartar')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Descartar o comprovante (não é pagamento, duplicado, conta errada...)' })
  @ApiBody({ schema: { type: 'object', properties: { reason: { type: 'string' } } } })
  discard(@Param('id') id: string, @Body() body: unknown, @CurrentUser() auth: AuthPayload) {
    return this.comprovantes.discard(id, body, auth.userId);
  }
}
