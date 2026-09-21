import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBody, ApiNoContentResponse, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../shared/auth/current-user.decorator';
import type { AuthPayload } from '../shared/auth/token';
import { ApiAuth } from '../shared/swagger/api-auth.decorator';
import { LedgerService } from './ledger.service';

@ApiTags('Fluxo de caixa')
@ApiAuth()
@Controller('api')
export class LedgerController {
  constructor(private readonly ledger: LedgerService) {}

  @Get('transactions')
  @ApiOperation({ summary: 'Listar lançamentos' })
  @ApiQuery({ name: 'from', required: false, example: '2026-01-01' })
  @ApiQuery({ name: 'to', required: false, example: '2026-12-31' })
  @ApiQuery({ name: 'branch', required: false })
  @ApiQuery({ name: 'type', required: false, description: 'income | expense' })
  @ApiQuery({
    name: 'nature',
    required: false,
    description: 'fixed | variable',
  })
  list(
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('branch') branch?: string,
    @Query('type') type?: string,
    @Query('nature') nature?: string,
  ) {
    return this.ledger.list({ from, to, branch, type, nature });
  }

  @Post('transactions')
  @ApiOperation({
    summary: 'Lançar transação',
    description:
      'O tipo precisa aceitar a direção. paymentStatus padrão paid. method: pix | cash | transfer | card | other.',
  })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['date', 'type', 'nature', 'movementTypeId', 'description', 'amount', 'branch', 'method'],
      properties: {
        date: { type: 'string', example: '2026-04-10' },
        type: { type: 'string', enum: ['income', 'expense'] },
        nature: { type: 'string', enum: ['fixed', 'variable'] },
        movementTypeId: { type: 'string' },
        description: { type: 'string' },
        amount: { type: 'number', example: 75 },
        branch: { type: 'string', example: 'escoteiro' },
        method: {
          type: 'string',
          enum: ['pix', 'cash', 'transfer', 'card', 'other'],
        },
        paymentStatus: { type: 'string', enum: ['paid', 'pending'] },
        memberId: { type: 'string' },
        memberGuardianId: { type: 'string' },
      },
    },
  })
  create(@Body() body: unknown, @CurrentUser() auth: AuthPayload) {
    return this.ledger.create(body, auth.userId);
  }

  @Patch('transactions/:id')
  @ApiOperation({
    summary: 'Atualizar lançamento',
    description: 'notifyReceipt: true dispara comprovante se o canal estiver configurado.',
  })
  update(@Param('id') id: string, @Body() body: unknown, @CurrentUser() auth: AuthPayload) {
    return this.ledger.update(id, body, auth.userId);
  }

  @Delete('transactions/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Excluir lançamento' })
  @ApiNoContentResponse()
  remove(@Param('id') id: string) {
    return this.ledger.remove(id);
  }

  @Post('transactions/:id/split')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Ratear lançamento',
    description: 'Mínimo duas partes. A soma dos valores precisa ser igual ao lançamento original.',
  })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['parts'],
      properties: {
        parts: {
          type: 'array',
          minItems: 2,
          items: {
            type: 'object',
            properties: {
              amount: { type: 'number' },
              movementTypeId: { type: 'string' },
              description: { type: 'string' },
            },
          },
        },
      },
    },
  })
  split(@Param('id') id: string, @Body() body: unknown, @CurrentUser() auth: AuthPayload) {
    return this.ledger.split(id, body, auth.userId);
  }
}
