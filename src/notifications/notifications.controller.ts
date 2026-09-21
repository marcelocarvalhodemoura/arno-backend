import { Controller, Get, Query } from '@nestjs/common';
import { NotificationsService } from './notifications.service';

@Controller('api/notify')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get('status')
  status() {
    return this.notifications.status();
  }

  @Get('log')
  log(@Query('limit') limit?: string) {
    return this.notifications.log(limit);
  }
}
