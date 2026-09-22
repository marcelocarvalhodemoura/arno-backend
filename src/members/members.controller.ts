import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBody, ApiNoContentResponse, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../shared/auth/current-user.decorator';
import type { AuthPayload } from '../shared/auth/token';
import { ApiAuth } from '../shared/swagger/api-auth.decorator';
import { MembersService } from './members.service';

@ApiTags('Associados')
@ApiAuth()
@Controller('api')
export class MembersController {
  constructor(private readonly members: MembersService) {}

  @Get('members')
  @ApiOperation({ summary: 'Listar associados' })
  @ApiQuery({
    name: 'branch',
    required: false,
    description: 'filhote | lobinho | escoteiro | senior | pioneiro | flor-de-lis',
  })
  @ApiQuery({
    name: 'status',
    required: false,
    description: 'active | inactive',
  })
  list(@Query('branch') branch?: string, @Query('status') status?: string) {
    return this.members.list(branch, status);
  }

  @Post('members')
  @ApiOperation({
    summary: 'Cadastrar associado',
    description:
      'Jovem exige pelo menos um responsável. Papéis: jovem | escotista | dirigente | clube. Só o jovem paga mensalidade; dirigente, escotista e Clube da Flor de Lis ficam isentos.',
  })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['name', 'email', 'phone', 'branch', 'role', 'joinedAt', 'clubeLtc'],
      properties: {
        name: { type: 'string', example: 'João Silva' },
        email: { type: 'string', example: 'joao@example.com' },
        phone: { type: 'string', example: '51999990000' },
        branch: { type: 'string', example: 'escoteiro' },
        role: {
          type: 'string',
          enum: ['jovem', 'escotista', 'dirigente', 'clube'],
        },
        joinedAt: { type: 'string', example: '2026-03-01' },
        clubeLtc: { type: 'boolean', example: false },
        guardians: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              relationship: { type: 'string' },
              phone: { type: 'string' },
              email: { type: 'string' },
            },
          },
        },
      },
    },
  })
  create(@Body() body: unknown, @CurrentUser() auth: AuthPayload) {
    return this.members.create(body, auth.userId);
  }

  @Patch('members/:id')
  @ApiOperation({
    summary: 'Atualizar associado',
    description: 'Enviar guardians substitui a lista. Inativar cancela mensalidades futuras pendentes.',
  })
  update(@Param('id') id: string, @Body() body: unknown, @CurrentUser() auth: AuthPayload) {
    return this.members.update(id, body, auth.userId);
  }

  @Post('members/:id/accounts')
  @ApiOperation({ summary: 'Adicionar conta de pagamento' })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['holderName', 'holderKind', 'relationship'],
      properties: {
        holderName: { type: 'string', example: 'Maria Silva' },
        holderKind: { type: 'string', enum: ['parent', 'youth', 'other'] },
        relationship: { type: 'string', example: 'Mãe' },
        pixKey: { type: 'string' },
        bank: { type: 'string' },
        agency: { type: 'string' },
        accountNumber: { type: 'string' },
        document: { type: 'string' },
        isPrimary: { type: 'boolean' },
      },
    },
  })
  addAccount(@Param('id') id: string, @Body() body: unknown, @CurrentUser() auth: AuthPayload) {
    return this.members.addAccount(id, body, auth.userId);
  }

  @Patch('member-accounts/:id')
  @ApiOperation({ summary: 'Atualizar conta de pagamento' })
  updateAccount(@Param('id') id: string, @Body() body: unknown, @CurrentUser() auth: AuthPayload) {
    return this.members.updateAccount(id, body, auth.userId);
  }

  @Delete('member-accounts/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Excluir conta de pagamento' })
  @ApiNoContentResponse()
  removeAccount(@Param('id') id: string) {
    return this.members.removeAccount(id);
  }

  @Post('integrations/members')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Importar associados (chunk)',
    description: 'Até 200 linhas por requisição. E-mail já existente atualiza responsáveis ou marca skipped.',
  })
  importMembers(@Body() body: unknown, @CurrentUser() auth: AuthPayload) {
    return this.members.importRows(body, auth.userId);
  }
}
