import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { ApiAuth } from '../shared/swagger/api-auth.decorator';
import { SnackFundService } from './snack-fund.service';

@ApiTags('Taxa do lanche')
@ApiAuth()
@Controller('api')
export class SnackFundController {
  constructor(private readonly snackFund: SnackFundService) {}

  @Get('snack-fund')
  @ApiOperation({
    summary: 'Saldo da taxa de lanche',
    description:
      'Arrecadado = parte do lanche (composição do mês de vencimento e do perfil) de cada mensalidade paga no período; sem taxa do clube. Gasto = saídas do tipo Lanche/Alimentação. Disponível = arrecadado − gasto. Sem month: resumo do ano.',
  })
  @ApiQuery({ name: 'year', required: false, example: '2026' })
  @ApiQuery({ name: 'month', required: false, example: '9', description: '1–12; omita para o resumo anual' })
  preview(@Query('year') year?: string, @Query('month') month?: string) {
    return this.snackFund.preview(year, month);
  }
}
