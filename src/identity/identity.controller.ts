import { Body, Controller, Get, HttpCode, HttpStatus, Param, Patch, Post } from '@nestjs/common';
import { CurrentUser } from '../shared/auth/current-user.decorator';
import { Public } from '../shared/auth/public.decorator';
import { Roles } from '../shared/auth/roles.decorator';
import type { AuthPayload } from '../shared/auth/token';
import { IdentityService } from './identity.service';

@Controller('api')
export class IdentityController {
  constructor(private readonly identity: IdentityService) {}

  @Public()
  @Post('auth/login')
  @HttpCode(HttpStatus.OK)
  login(@Body() body: unknown) {
    return this.identity.login(body);
  }

  @Get('auth/me')
  me(@CurrentUser() auth: AuthPayload) {
    return this.identity.me(auth);
  }

  @Roles('admin')
  @Get('users')
  list() {
    return this.identity.list();
  }

  @Roles('admin')
  @Post('users')
  create(@Body() body: unknown, @CurrentUser() auth: AuthPayload) {
    return this.identity.create(body, auth.userId);
  }

  @Roles('admin')
  @Patch('users/:id')
  update(@Param('id') id: string, @Body() body: unknown, @CurrentUser() auth: AuthPayload) {
    return this.identity.update(id, body, auth.userId);
  }

  @Roles('admin')
  @Post('admin/reset')
  @HttpCode(HttpStatus.OK)
  reset() {
    return this.identity.reset();
  }
}
