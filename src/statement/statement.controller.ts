import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiBody, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../shared/auth/current-user.decorator';
import type { AuthPayload } from '../shared/auth/token';
import { ApiAuth } from '../shared/swagger/api-auth.decorator';
import { StatementService } from './statement.service';

@ApiTags('Extrato')
@ApiAuth()
@Controller('api/integrations')
export class StatementController {
  constructor(private readonly statement: StatementService) {}

  @Post('interpret-statement')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Interpretar extrato (CSV ou PDF)',
    description: 'Envia csv (texto) ou pdf (base64). enrichAi usa OpenAI se houver chave.',
  })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        csv: {
          type: 'string',
          example: 'Data;Historico;Valor\n10/04/2026;PIX JOAO SILVA;75,00',
        },
        pdf: { type: 'string', description: 'PDF em base64' },
        enrichAi: { type: 'boolean', example: false },
        convertOnly: { type: 'boolean' },
      },
    },
  })
  interpret(@Body() body: unknown, @CurrentUser() auth: AuthPayload) {
    return this.statement.interpret(body, auth.userId);
  }

  @Post('map-import')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Mapear colunas da planilha',
    description: 'kind: members | statement. Sem mapping, devolve revisão + amostragem.',
  })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        csv: { type: 'string' },
        kind: { type: 'string', enum: ['members', 'statement'] },
        mapping: { type: 'object', additionalProperties: true },
      },
    },
  })
  mapImport(@Body() body: unknown) {
    return this.statement.mapImport(body);
  }

  @Post('transactions')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Ingerir lançamentos do extrato',
    description:
      'Chunk de até 200 linhas. Origem: integration. Informe importSource=csv|pdf no corpo ou em cada linha.',
  })
  ingest(@Body() body: unknown, @CurrentUser() auth: AuthPayload) {
    return this.statement.ingest(body, auth.userId);
  }
}
