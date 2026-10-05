import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../shared/auth/current-user.decorator';
import { Roles } from '../shared/auth/roles.decorator';
import type { AuthPayload } from '../shared/auth/token';
import { ApiAuth } from '../shared/swagger/api-auth.decorator';
import { FeeScheduleService } from './fee-schedule.service';

@ApiTags('Mensalidades')
@ApiAuth()
@Controller('api/fee-schedule')
export class FeeScheduleController {
  constructor(private readonly schedule: FeeScheduleService) {}

  @Get()
  @ApiOperation({
    summary: 'Composição da mensalidade por período',
    description: 'Partes de cada perfil (grupo, caixinha, lanche, clube, diluição, atraso) e meses de vigência.',
  })
  list() {
    return this.schedule.list();
  }

  @Post()
  @Roles('admin')
  @ApiOperation({
    summary: 'Criar período de composição',
    description: 'Cobranças em aberto passam a seguir a nova composição; mensalidades pagas não mudam.',
  })
  create(@Body() body: unknown, @CurrentUser() auth: AuthPayload) {
    return this.schedule.create(body, auth.userId);
  }

  @Patch(':id')
  @Roles('admin')
  @ApiOperation({ summary: 'Alterar período de composição' })
  update(@Param('id') id: string, @Body() body: unknown, @CurrentUser() auth: AuthPayload) {
    return this.schedule.update(id, body, auth.userId);
  }

  @Delete(':id')
  @Roles('admin')
  @ApiOperation({ summary: 'Excluir período de composição' })
  remove(@Param('id') id: string, @CurrentUser() auth: AuthPayload) {
    return this.schedule.remove(id, auth.userId);
  }
}
