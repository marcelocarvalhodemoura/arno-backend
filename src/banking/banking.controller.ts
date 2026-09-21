import { Body, Controller, Get, HttpCode, HttpStatus, Post, Query } from '@nestjs/common';
import { CurrentUser } from '../shared/auth/current-user.decorator';
import { Public } from '../shared/auth/public.decorator';
import type { AuthPayload } from '../shared/auth/token';
import { BankingService } from './banking.service';

@Controller('api/integrations/sicredi')
export class BankingController {
  constructor(private readonly banking: BankingService) {}

  @Public()
  @Post('webhook')
  @HttpCode(HttpStatus.OK)
  webhook(@Query('token') token: string | undefined, @Body() body: unknown) {
    return this.banking.ingestWebhook(token, body);
  }

  @Get()
  overview(@Query('from') from?: string, @Query('to') to?: string) {
    return this.banking.overview(from, to);
  }

  @Post('sync')
  @HttpCode(HttpStatus.OK)
  sync(@Body() body: unknown, @CurrentUser() auth: AuthPayload) {
    return this.banking.sync(body, auth.userId);
  }

  @Post('simulate')
  @HttpCode(HttpStatus.OK)
  simulate(@CurrentUser() auth: AuthPayload) {
    return this.banking.simulate(auth.userId);
  }

  @Post('webhook/register')
  @HttpCode(HttpStatus.OK)
  registerWebhook() {
    return this.banking.registerWebhook();
  }
}
