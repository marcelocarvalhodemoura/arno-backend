import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { ApiAuth } from '../shared/swagger/api-auth.decorator';
import { AllocationsService } from './allocations.service';

@ApiTags('Divisão das mensalidades')
@ApiAuth()
@Controller('api/allocations')
export class AllocationsController {
  constructor(private readonly allocations: AllocationsService) {}

  @Get('conference')
  @ApiOperation({
    summary: 'Conferência das mensalidades do ano',
    description:
      'Totais por destino (operacional, caixinha do ramo, lanche, clube, diluição, atraso, dívida) a partir da divisão gravada em cada pagamento, por ramo, e a lista do que precisa de atenção: diferença entre recebido e esperado, divisão a confirmar, divisão que mudaria com a composição/cadastro de hoje e mensalidade paga sem associado.',
  })
  @ApiQuery({ name: 'year', required: false, example: '2026' })
  conference(@Query('year') year?: string) {
    return this.allocations.conference(year);
  }

  @Get(':transactionId')
  @ApiOperation({
    summary: 'Cálculo de uma mensalidade paga',
    description: 'Divisão gravada no pagamento, a conta por extenso e como ficaria com a composição/cadastro de hoje.',
  })
  ofTransaction(@Param('transactionId') transactionId: string) {
    return this.allocations.ofTransaction(transactionId);
  }
}
