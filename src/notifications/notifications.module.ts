import { Module } from '@nestjs/common';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { WhatsappWebhookController } from './whatsapp-webhook.controller';

@Module({
  controllers: [NotificationsController, WhatsappWebhookController],
  providers: [NotificationsService],
})
export class NotificationsModule {}
