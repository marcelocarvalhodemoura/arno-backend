import { Global, Module } from '@nestjs/common';
import { NotificationDispatcher, notificationDispatcher } from './notification-dispatcher';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { WhatsappWebhookController } from './whatsapp-webhook.controller';

@Global()
@Module({
  controllers: [NotificationsController, WhatsappWebhookController],
  providers: [NotificationsService, { provide: NotificationDispatcher, useValue: notificationDispatcher }],
  exports: [NotificationDispatcher],
})
export class NotificationsModule {}
