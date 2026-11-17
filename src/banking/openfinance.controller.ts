import { Body, Controller, Get, HttpCode, HttpStatus, Post, Query } from '@nestjs/common';
import { ApiBody, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { ApiAuth } from '../shared/swagger/api-auth.decorator';
import { OpenFinanceService } from './openfinance.service';

@ApiTags('Open Finance (Pluggy)')
@Controller('api/integrations/openfinance')
export class OpenFinanceController {
  constructor(private readonly openFinance: OpenFinanceService) {}

  @Get('movements')
  @ApiAuth()
  @ApiOperation({
    summary: 'Entradas e saídas do mês',
    description: 'Lê os lançamentos já sincronizados da conta Sicredi PJ.',
  })
  @ApiQuery({ name: 'month', required: false, example: '2026-09' })
  movements(@Query('month') month?: string) {
    return this.openFinance.movements(month);
  }

  @Post('sync')
  @HttpCode(HttpStatus.OK)
  @ApiAuth()
  @ApiOperation({ summary: 'Sincronizar extrato do mês pelo Pluggy' })
  @ApiBody({
    schema: { type: 'object', properties: { month: { type: 'string', example: '2026-09' } } },
  })
  sync(@Body() body: unknown) {
    return this.openFinance.sync(body);
  }
}
