import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { ApiAuth } from '../shared/swagger/api-auth.decorator';
import { BranchLedgerService } from './branch-ledger.service';

@ApiTags('Extrato do ramo')
@ApiAuth()
@Controller('api/branch-ledger')
export class BranchLedgerController {
  constructor(private readonly ledger: BranchLedgerService) {}

  @Get()
  @ApiOperation({
    summary: 'Extrato do ramo mês a mês',
    description:
      'Caixinha das mensalidades dos jovens do ramo (divisão gravada no pagamento) + receitas lançadas no ramo − saídas do ramo, com saldo acumulado desde o primeiro lançamento e o total por tipo de movimentação. Mês = data do lançamento (a mesma do livro-caixa).',
  })
  @ApiQuery({ name: 'branch', required: true, example: 'lobinho' })
  statement(@Query('branch') branch?: string) {
    return this.ledger.statement(branch);
  }

  @Get('lines')
  @ApiOperation({ summary: 'Lançamentos de um mês do extrato do ramo' })
  @ApiQuery({ name: 'branch', required: true, example: 'lobinho' })
  @ApiQuery({ name: 'month', required: true, example: '2026-05' })
  lines(@Query('branch') branch?: string, @Query('month') month?: string) {
    return this.ledger.lines(branch, month);
  }

  @Get('money-map')
  @ApiOperation({
    summary: 'Para onde foi cada real',
    description:
      'Saldo de cada destino (grupo, cada ramo, fundo do lanche, clube a repassar, a conferir). A soma é o saldo de caixa do sistema.',
  })
  @ApiQuery({ name: 'until', required: false, example: '2026-10-31' })
  moneyMap(@Query('until') until?: string) {
    return this.ledger.moneyMap(until);
  }
}
