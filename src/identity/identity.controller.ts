import { Body, Controller, Get, HttpCode, HttpStatus, Param, Patch, Post } from '@nestjs/common';
import { ApiBody, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../shared/auth/current-user.decorator';
import { Public } from '../shared/auth/public.decorator';
import { Roles } from '../shared/auth/roles.decorator';
import type { AuthPayload } from '../shared/auth/token';
import { ApiAdmin, ApiAuth } from '../shared/swagger/api-auth.decorator';
import { IdentityService } from './identity.service';

@Controller('api')
export class IdentityController {
  constructor(private readonly identity: IdentityService) {}

  @Public()
  @Post('auth/login')
  @HttpCode(HttpStatus.OK)
  @ApiTags('Saúde e autenticação')
  @ApiOperation({
    summary: 'Login',
    description: 'Autentica por usuário/e-mail e senha. Devolve token HMAC (12h), papel, nome e nome do grupo.',
  })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['user', 'password'],
      properties: {
        user: { type: 'string', example: 'tesouraria' },
        password: { type: 'string', example: 'arno1991' },
      },
    },
  })
  @ApiOkResponse({ description: 'Sessão criada' })
  login(@Body() body: unknown) {
    return this.identity.login(body);
  }

  @Get('auth/me')
  @ApiTags('Saúde e autenticação')
  @ApiAuth()
  @ApiOperation({
    summary: 'Sessão atual',
    description: 'Retorna usuário, papel e userId do token Bearer.',
  })
  me(@CurrentUser() auth: AuthPayload) {
    return this.identity.me(auth);
  }

  @Roles('admin')
  @Get('users')
  @ApiTags('Usuários')
  @ApiAdmin()
  @ApiOperation({ summary: 'Listar usuários' })
  list() {
    return this.identity.list();
  }

  @Roles('admin')
  @Post('users')
  @ApiTags('Usuários')
  @ApiAdmin()
  @ApiOperation({
    summary: 'Criar usuário',
    description: 'Cria admin ou tesoureiro. Senha mínima de 6 caracteres; password e passwordConfirm devem coincidir.',
  })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['username', 'name', 'email', 'password', 'passwordConfirm', 'role'],
      properties: {
        username: { type: 'string', example: 'tesoureiro2' },
        name: { type: 'string', example: 'Tesoureiro Adjunto' },
        email: { type: 'string', example: 'tesoureiro2@arnofriedrich.org.br' },
        password: { type: 'string', minLength: 6 },
        passwordConfirm: { type: 'string', minLength: 6 },
        role: { type: 'string', enum: ['admin', 'tesoureiro'] },
      },
    },
  })
  create(@Body() body: unknown, @CurrentUser() auth: AuthPayload) {
    return this.identity.create(body, auth.userId);
  }

  @Roles('admin')
  @Patch('users/:id')
  @ApiTags('Usuários')
  @ApiAdmin()
  @ApiOperation({
    summary: 'Atualizar usuário',
    description: 'currentPassword é a senha do admin logado, não a do usuário alvo.',
  })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['currentPassword'],
      properties: {
        name: { type: 'string' },
        email: { type: 'string' },
        role: { type: 'string', enum: ['admin', 'tesoureiro'] },
        active: { type: 'boolean' },
        password: { type: 'string' },
        passwordConfirm: { type: 'string' },
        currentPassword: { type: 'string' },
      },
    },
  })
  update(@Param('id') id: string, @Body() body: unknown, @CurrentUser() auth: AuthPayload) {
    return this.identity.update(id, body, auth.userId);
  }

  @Roles('admin')
  @Post('admin/reset')
  @HttpCode(HttpStatus.OK)
  @ApiTags('Usuários')
  @ApiAdmin()
  @ApiOperation({
    summary: 'Resetar dados financeiros',
    description: 'Apaga associados, lançamentos, projetos, taxas, tipos e a fila de e-mails. Mantém usuários.',
  })
  reset() {
    return this.identity.reset();
  }
}
