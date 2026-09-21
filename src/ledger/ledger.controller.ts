import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, Query } from '@nestjs/common';
import { CurrentUser } from '../shared/auth/current-user.decorator';
import type { AuthPayload } from '../shared/auth/token';
import { LedgerService } from './ledger.service';

@Controller('api')
export class LedgerController {
  constructor(private readonly ledger: LedgerService) {}

  @Get('transactions')
  list(
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('branch') branch?: string,
    @Query('type') type?: string,
    @Query('nature') nature?: string,
  ) {
    return this.ledger.list({ from, to, branch, type, nature });
  }

  @Post('transactions')
  create(@Body() body: unknown, @CurrentUser() auth: AuthPayload) {
    return this.ledger.create(body, auth.userId);
  }

  @Patch('transactions/:id')
  update(@Param('id') id: string, @Body() body: unknown, @CurrentUser() auth: AuthPayload) {
    return this.ledger.update(id, body, auth.userId);
  }

  @Delete('transactions/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id') id: string) {
    return this.ledger.remove(id);
  }

  @Post('transactions/:id/split')
  @HttpCode(HttpStatus.OK)
  split(@Param('id') id: string, @Body() body: unknown, @CurrentUser() auth: AuthPayload) {
    return this.ledger.split(id, body, auth.userId);
  }
}
