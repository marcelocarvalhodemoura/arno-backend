import { Body, Controller, Get, HttpCode, HttpStatus, Post, Query } from '@nestjs/common';
import { ApiBody, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { Roles } from '../shared/auth/roles.decorator';
import { ApiAdmin, ApiAuth } from '../shared/swagger/api-auth.decorator';
import { ReportsService } from './reports.service';

@ApiTags('Painel e relatórios')
@Controller('api')
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Roles('admin')
  @Get('dashboard')
  @ApiAdmin()
  @ApiOperation({ summary: 'Painel (dashboard)' })
  @ApiQuery({ name: 'year', required: false, example: '2026' })
  @ApiQuery({
    name: 'month',
    required: false,
    example: '4',
    description: '1–12; omita para o ano',
  })
  dashboard(@Query('year') year?: string, @Query('month') month?: string) {
    return this.reports.dashboard(year, month);
  }

  @Get('reports/cashflow')
  @ApiAuth()
  @ApiOperation({ summary: 'Relatório de fluxo de caixa' })
  @ApiQuery({ name: 'from', required: false, example: '2026-01-01' })
  @ApiQuery({ name: 'to', required: false, example: '2026-12-31' })
  cashFlow(@Query('from') from?: string, @Query('to') to?: string) {
    return this.reports.cashFlow(from, to);
  }

  @Roles('admin')
  @Post('reports/custom')
  @HttpCode(HttpStatus.OK)
  @ApiAdmin()
  @ApiOperation({
    summary: 'Relatório fiscal / customizado',
    description: 'Livro-caixa numerado. groupBy: none | month | branch | movementType | nature.',
  })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        from: { type: 'string', example: '2026-01-01' },
        to: { type: 'string', example: '2026-12-31' },
        branches: { type: 'array', items: { type: 'string' } },
        types: { type: 'array', items: { type: 'string' } },
        natures: { type: 'array', items: { type: 'string' } },
        movementTypeIds: { type: 'array', items: { type: 'string' } },
        groupBy: {
          type: 'string',
          enum: ['none', 'month', 'branch', 'movementType', 'nature'],
        },
      },
    },
  })
  custom(@Body() body: unknown) {
    return this.reports.custom(body);
  }
}
