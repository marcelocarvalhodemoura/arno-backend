import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { ApiAuth } from '../shared/swagger/api-auth.decorator';
import { NotificationsService } from './notifications.service';

@ApiTags('Notificações')
@ApiAuth()
@Controller('api/notify')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get('status')
  @ApiOperation({ summary: 'Status dos canais' })
  status() {
    return this.notifications.status();
  }

  @Get('log')
  @ApiOperation({ summary: 'Histórico de disparos' })
  @ApiQuery({ name: 'limit', required: false, example: '40' })
  log(@Query('limit') limit?: string) {
    return this.notifications.log(limit);
  }
}
