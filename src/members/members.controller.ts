import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, Query } from '@nestjs/common';
import { CurrentUser } from '../shared/auth/current-user.decorator';
import type { AuthPayload } from '../shared/auth/token';
import { MembersService } from './members.service';

@Controller('api')
export class MembersController {
  constructor(private readonly members: MembersService) {}

  @Get('members')
  list(@Query('branch') branch?: string, @Query('status') status?: string) {
    return this.members.list(branch, status);
  }

  @Post('members')
  create(@Body() body: unknown, @CurrentUser() auth: AuthPayload) {
    return this.members.create(body, auth.userId);
  }

  @Patch('members/:id')
  update(@Param('id') id: string, @Body() body: unknown, @CurrentUser() auth: AuthPayload) {
    return this.members.update(id, body, auth.userId);
  }

  @Post('members/:id/accounts')
  addAccount(@Param('id') id: string, @Body() body: unknown, @CurrentUser() auth: AuthPayload) {
    return this.members.addAccount(id, body, auth.userId);
  }

  @Patch('member-accounts/:id')
  updateAccount(@Param('id') id: string, @Body() body: unknown, @CurrentUser() auth: AuthPayload) {
    return this.members.updateAccount(id, body, auth.userId);
  }

  @Delete('member-accounts/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  removeAccount(@Param('id') id: string) {
    return this.members.removeAccount(id);
  }

  @Post('integrations/members')
  @HttpCode(HttpStatus.OK)
  importMembers(@Body() body: unknown, @CurrentUser() auth: AuthPayload) {
    return this.members.importRows(body, auth.userId);
  }
}
