import { Body, Controller, Get, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { Public } from '../shared/auth/public.decorator';
import { NotificationsService } from './notifications.service';

@Public()
@Controller(['webhook', 'api/integrations/whatsapp/webhook'])
export class WhatsappWebhookController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
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
  receive(@Body() body: unknown, @Res() res: Response) {
    if (!this.notifications.receiveEvent(body)) {
      console.log('Evento recebido:', JSON.stringify(body, null, 2));
      return res.sendStatus(404);
    }
    return res.status(200).type('text/plain').send('EVENT_RECEIVED');
  }
}
