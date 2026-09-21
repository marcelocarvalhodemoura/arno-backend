import { Body, Controller, Get, HttpCode, HttpStatus, Post, Query } from '@nestjs/common';
import { ApiBody, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../shared/auth/current-user.decorator';
import { Public } from '../shared/auth/public.decorator';
import type { AuthPayload } from '../shared/auth/token';
import { ApiAuth } from '../shared/swagger/api-auth.decorator';
import { BankingService } from './banking.service';

@ApiTags('Sicredi Pix')
@Controller('api/integrations/sicredi')
export class BankingController {
  constructor(private readonly banking: BankingService) {}

  @Public()
  @Post('webhook')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Webhook Pix (público)',
    description: 'Autenticado por token na query (SICREDI_WEBHOOK_TOKEN). Corpo no formato Bacen/Sicredi.',
  })
  @ApiQuery({
    name: 'token',
    required: true,
    description: 'SICREDI_WEBHOOK_TOKEN',
  })
  @ApiBody({
    schema: {
      type: 'object',
      properties: { pix: { type: 'array', items: { type: 'object' } } },
    },
  })
  webhook(@Query('token') token: string | undefined, @Body() body: unknown) {
    return this.banking.ingestWebhook(token, body);
  }

  @Get()
  @ApiAuth()
  @ApiOperation({ summary: 'Visão Sicredi' })
  @ApiQuery({ name: 'from', required: false, example: '2026-04-01' })
  @ApiQuery({ name: 'to', required: false, example: '2026-04-30' })
  overview(@Query('from') from?: string, @Query('to') to?: string) {
    return this.banking.overview(from, to);
  }

  @Post('sync')
  @HttpCode(HttpStatus.OK)
  @ApiAuth()
  @ApiOperation({ summary: 'Sincronizar Pix agora' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        from: { type: 'string', example: '2026-04-01' },
        to: { type: 'string', example: '2026-04-30' },
      },
    },
  })
  sync(@Body() body: unknown, @CurrentUser() auth: AuthPayload) {
    return this.banking.sync(body, auth.userId);
  }

  @Post('simulate')
  @HttpCode(HttpStatus.OK)
  @ApiAuth()
  @ApiOperation({
    summary: 'Simular Pix recebido',
    description: 'Só com SICREDI_MOCK=1.',
  })
  simulate(@CurrentUser() auth: AuthPayload) {
    return this.banking.simulate(auth.userId);
  }

  @Post('webhook/register')
  @HttpCode(HttpStatus.OK)
  @ApiAuth()
  @ApiOperation({
    summary: 'Registrar webhook Pix',
    description: 'Registra PUBLIC_URL/api/integrations/sicredi/webhook?token=SICREDI_WEBHOOK_TOKEN.',
  })
  registerWebhook() {
    return this.banking.registerWebhook();
  }
}
