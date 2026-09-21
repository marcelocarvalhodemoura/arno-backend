import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post } from '@nestjs/common';
import { ApiBody, ApiNoContentResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../shared/auth/current-user.decorator';
import type { AuthPayload } from '../shared/auth/token';
import { ApiAuth } from '../shared/swagger/api-auth.decorator';
import { CatalogService } from './catalog.service';

@ApiTags('Catálogo')
@ApiAuth()
@Controller('api')
export class CatalogController {
  constructor(private readonly catalog: CatalogService) {}

  @Get('settings')
  @ApiOperation({ summary: 'Ler configurações' })
  getSettings() {
    return this.catalog.getSettings();
  }

  @Patch('settings')
  @ApiOperation({
    summary: 'Alterar configurações',
    description: 'Tesoureiro só altera mensalidadeDueDay. Nome do grupo e saldo inicial exigem admin.',
  })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        mensalidadeDueDay: {
          type: 'integer',
          example: 10,
          minimum: 1,
          maximum: 31,
        },
        openingBalance: { type: 'number', example: 0 },
        groupName: {
          type: 'string',
          example: 'Grupo Escoteiro Arno Friedrich',
        },
      },
    },
  })
  updateSettings(@Body() body: unknown, @CurrentUser() auth: AuthPayload) {
    return this.catalog.updateSettings(body, auth);
  }

  @Get('movement-types')
  @ApiOperation({ summary: 'Listar tipos de movimentação' })
  listMovementTypes() {
    return this.catalog.listMovementTypes();
  }

  @Post('movement-types')
  @ApiOperation({ summary: 'Criar tipo de movimentação' })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['name', 'direction'],
      properties: {
        name: { type: 'string', example: 'Doação' },
        direction: { type: 'string', enum: ['income', 'expense', 'both'] },
        description: { type: 'string' },
        pixKey: { type: 'string' },
        branch: { type: 'string', example: 'grupo' },
      },
    },
  })
  createMovementType(@Body() body: unknown, @CurrentUser() auth: AuthPayload) {
    return this.catalog.createMovementType(body, auth.userId);
  }

  @Patch('movement-types/:id')
  @ApiOperation({ summary: 'Atualizar tipo de movimentação' })
  updateMovementType(@Param('id') id: string, @Body() body: unknown, @CurrentUser() auth: AuthPayload) {
    return this.catalog.updateMovementType(id, body, auth.userId);
  }

  @Get('fees')
  @ApiOperation({ summary: 'Listar taxas' })
  listFees(@CurrentUser() auth: AuthPayload) {
    return this.catalog.listFees(auth.userId);
  }

  @Post('fees')
  @ApiOperation({ summary: 'Criar taxa' })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['name', 'amount'],
      properties: {
        name: { type: 'string', example: 'Taxa de acampamento' },
        amount: { type: 'number', example: 50 },
      },
    },
  })
  createFee(@Body() body: unknown, @CurrentUser() auth: AuthPayload) {
    return this.catalog.createFee(body, auth.userId);
  }

  @Patch('fees/:id')
  @ApiOperation({ summary: 'Atualizar taxa' })
  updateFee(@Param('id') id: string, @Body() body: unknown, @CurrentUser() auth: AuthPayload) {
    return this.catalog.updateFee(id, body, auth.userId);
  }

  @Delete('fees/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Excluir taxa' })
  @ApiNoContentResponse()
  deleteFee(@Param('id') id: string) {
    return this.catalog.deleteFee(id);
  }

  @Get('meta')
  @ApiOperation({ summary: 'Metadados de ramos' })
  meta() {
    return this.catalog.meta();
  }
}
