import { Body, Controller, Get, Post, Query, Res } from '@nestjs/common';
import { ApiBody, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { Public } from '../shared/auth/public.decorator';
import { NotificationsService } from './notifications.service';

@ApiTags('Notificações')
@Public()
@Controller(['webhook', 'api/integrations/whatsapp/webhook'])
export class WhatsappWebhookController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  @ApiOperation({
    summary: 'WhatsApp — verificação (GET)',
    description:
      'Handshake da Meta (hub.mode=subscribe, hub.verify_token, hub.challenge). Sem query devolve { ok, service }.',
  })
  @ApiQuery({ name: 'hub.mode', required: false, example: 'subscribe' })
  @ApiQuery({ name: 'hub.verify_token', required: false })
  @ApiQuery({ name: 'hub.challenge', required: false })
  verify(@Query() query: Record<string, unknown>, @Res() res: Response) {
    const { mode, token, challenge } = this.notifications.verifyHub(query);
    if (!mode && !token && !challenge) {
      return res.json({ ok: true, service: 'whatsapp-webhook' });
    }
    if (!this.notifications.isValidVerify(mode, token)) {
      return res.sendStatus(403);
    }
    return res.status(200).type('text/plain').send(challenge);
  }

  @Post()
  @ApiOperation({
    summary: 'WhatsApp — evento (POST)',
    description: 'Recebe mensagens da Cloud API. Responde EVENT_RECEIVED. Objeto inválido retorna 404.',
  })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        object: { type: 'string', example: 'whatsapp_business_account' },
        entry: { type: 'array', items: { type: 'object' } },
      },
    },
  })
  receive(@Body() body: unknown, @Res() res: Response) {
    if (!this.notifications.receiveEvent(body)) {
      console.log('Evento recebido:', JSON.stringify(body, null, 2));
      return res.sendStatus(404);
    }
    return res.status(200).type('text/plain').send('EVENT_RECEIVED');
  }
}
