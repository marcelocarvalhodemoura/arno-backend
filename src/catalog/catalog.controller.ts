import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post } from '@nestjs/common';
import { CurrentUser } from '../shared/auth/current-user.decorator';
import type { AuthPayload } from '../shared/auth/token';
import { CatalogService } from './catalog.service';

@Controller('api')
export class CatalogController {
  constructor(private readonly catalog: CatalogService) {}

  @Get('settings')
  getSettings() {
    return this.catalog.getSettings();
  }

  @Patch('settings')
  updateSettings(@Body() body: unknown, @CurrentUser() auth: AuthPayload) {
    return this.catalog.updateSettings(body, auth);
  }

  @Get('movement-types')
  listMovementTypes() {
    return this.catalog.listMovementTypes();
  }

  @Post('movement-types')
  createMovementType(@Body() body: unknown, @CurrentUser() auth: AuthPayload) {
    return this.catalog.createMovementType(body, auth.userId);
  }

  @Patch('movement-types/:id')
  updateMovementType(@Param('id') id: string, @Body() body: unknown, @CurrentUser() auth: AuthPayload) {
    return this.catalog.updateMovementType(id, body, auth.userId);
  }

  @Get('fees')
  listFees(@CurrentUser() auth: AuthPayload) {
    return this.catalog.listFees(auth.userId);
  }

  @Post('fees')
  createFee(@Body() body: unknown, @CurrentUser() auth: AuthPayload) {
    return this.catalog.createFee(body, auth.userId);
  }

  @Patch('fees/:id')
  updateFee(@Param('id') id: string, @Body() body: unknown, @CurrentUser() auth: AuthPayload) {
    return this.catalog.updateFee(id, body, auth.userId);
  }

  @Delete('fees/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteFee(@Param('id') id: string) {
    return this.catalog.deleteFee(id);
  }

  @Get('meta')
  meta() {
    return this.catalog.meta();
  }
}
