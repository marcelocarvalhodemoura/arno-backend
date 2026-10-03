import { Body, Controller, Get, HttpCode, HttpStatus, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../shared/auth/current-user.decorator';
import { Roles } from '../shared/auth/roles.decorator';
import type { AuthPayload } from '../shared/auth/token';
import { ApiAuth } from '../shared/swagger/api-auth.decorator';
import { AuditService } from './audit.service';

@ApiTags('Auditoria')
@ApiAuth()
@Controller('api')
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Post('audit/page')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Registrar tela aberta (uso do sistema)' })
  page(@Body() body: unknown, @CurrentUser() auth: AuthPayload) {
    return this.audit.page(body, auth.userId);
  }

  @Get('audit/overview')
  @Roles('superadmin')
  @ApiOperation({ summary: 'Auditoria de uso: interações por usuário, telas e ações (super admin)' })
  @ApiQuery({ name: 'days', required: false, example: '30' })
  overview(@Query('days') days?: string) {
    return this.audit.overview(days);
  }
}
