import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBody, ApiConsumes, ApiNoContentResponse, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { memoryStorage } from 'multer';
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

  @Post('transactions/:id/nota')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: 10 * 1024 * 1024 },
    }),
  )
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary: 'Anexar nota ao lançamento',
    description: 'PDF ou imagem (JPEG, PNG, WebP, GIF), até 10 MB. Substitui a nota anterior.',
  })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      properties: {
        file: { type: 'string', format: 'binary' },
      },
    },
  })
  uploadNota(
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @CurrentUser() auth: AuthPayload,
  ) {
    return this.ledger.uploadNota(id, file, auth.userId);
  }

  @Get('transactions/:id/nota')
  @ApiOperation({
    summary: 'Obter URL ampliada da nota',
    description: 'Devolve URL assinada (temporária) para visualizar a nota em tela cheia.',
  })
  getNota(@Param('id') id: string) {
    return this.ledger.getNota(id);
  }

  @Delete('transactions/:id/nota')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Remover nota do lançamento' })
  @ApiNoContentResponse()
  removeNota(@Param('id') id: string, @CurrentUser() auth: AuthPayload) {
    return this.ledger.removeNota(id, auth.userId);
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
              memberId: { type: 'string', nullable: true },
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
