import { Body, Controller, Get, HttpCode, HttpStatus, Post, Query } from '@nestjs/common';
import { ApiBody, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../shared/auth/current-user.decorator';
import type { AuthPayload } from '../shared/auth/token';
import { ApiAuth } from '../shared/swagger/api-auth.decorator';
import { ClubRemittanceService } from './club-remittance.service';

@ApiTags('Repasse ao clube')
@ApiAuth()
@Controller('api')
export class ClubRemittanceController {
  constructor(private readonly remittance: ClubRemittanceService) {}

  @Get('club-remittance')
  @ApiOperation({
    summary: 'Prévia do repasse da taxa Lindóia',
    description:
      'Sem month: resumo do ano. Com month: lista as mensalidades pagas naquele mês (paidAt) com taxa do clube incluída e o total a repassar (valor no prazo ou após o vencimento conforme a composição do mês; diluição do grupo não entra).',
  })
  @ApiQuery({ name: 'year', required: false, example: '2026' })
  @ApiQuery({ name: 'month', required: false, example: '9', description: '1–12; omita para o resumo anual' })
  preview(@Query('year') year?: string, @Query('month') month?: string) {
    return this.remittance.preview(year, month);
  }

  @Post('club-remittance')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Registrar o repasse do mês no caixa',
    description:
      'Cria uma saída no fluxo de caixa com o total da taxa Lindóia arrecadada nos pagamentos do mês. Idempotente por mês (externalId).',
  })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['year', 'month'],
      properties: {
        year: { type: 'integer', example: 2026 },
        month: { type: 'integer', example: 9 },
        date: { type: 'string', example: '2026-09-30', description: 'Data do lançamento da saída' },
        method: { type: 'string', enum: ['pix', 'cash', 'transfer', 'card', 'other'] },
        notes: { type: 'string' },
      },
    },
  })
  register(@Body() body: unknown, @CurrentUser() auth: AuthPayload) {
    return this.remittance.register(body, auth.userId);
  }
}
