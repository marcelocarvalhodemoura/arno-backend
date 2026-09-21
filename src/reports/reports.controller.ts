import { Body, Controller, Get, HttpCode, HttpStatus, Post, Query } from '@nestjs/common';
import { Roles } from '../shared/auth/roles.decorator';
import { ReportsService } from './reports.service';

@Controller('api')
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Roles('admin')
  @Get('dashboard')
  dashboard(@Query('year') year?: string, @Query('month') month?: string) {
    return this.reports.dashboard(year, month);
  }

  @Get('reports/cashflow')
  cashFlow(@Query('from') from?: string, @Query('to') to?: string) {
    return this.reports.cashFlow(from, to);
  }

  @Roles('admin')
  @Post('reports/custom')
  @HttpCode(HttpStatus.OK)
  custom(@Body() body: unknown) {
    return this.reports.custom(body);
  }
}
