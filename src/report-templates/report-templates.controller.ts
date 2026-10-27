import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiBody, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../shared/auth/current-user.decorator';
import { Roles } from '../shared/auth/roles.decorator';
import type { AuthPayload } from '../shared/auth/token';
import { ApiAdmin } from '../shared/swagger/api-auth.decorator';
import { ReportTemplatesService } from './report-templates.service';

const templateSchema = {
  type: 'object',
  properties: {
    name: { type: 'string', example: 'Saídas do acampamento' },
    query: {
      type: 'object',
      example: {
        period: { preset: 'ytd' },
        types: ['expense'],
        groupBy: 'movementType',
        branches: ['lobinho'],
        movementTypeIds: [],
        memberIds: [],
        showLedger: true,
      },
    },
  },
};

@ApiTags('Painel e relatórios')
@ApiAdmin()
@Roles('admin')
@Controller('api/report-templates')
export class ReportTemplatesController {
  constructor(private readonly templates: ReportTemplatesService) {}

  @Get()
  @ApiOperation({ summary: 'Modelos de relatório personalizado salvos' })
  list() {
    return this.templates.list();
  }

  @Post()
  @ApiOperation({
    summary: 'Salvar modelo de relatório',
    description: 'period: { preset: month|prev|ytd|s1|s2|lastYear } (recalculado ao abrir) ou { from, to } fixos.',
  })
  @ApiBody({ schema: templateSchema })
  create(@Body() body: unknown, @CurrentUser() auth: AuthPayload) {
    return this.templates.create(body, auth.userId);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Renomear ou regravar as escolhas de um modelo' })
  @ApiBody({ schema: templateSchema })
  update(@Param('id') id: string, @Body() body: unknown, @CurrentUser() auth: AuthPayload) {
    return this.templates.update(id, body, auth.userId);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Apagar modelo de relatório' })
  remove(@Param('id') id: string) {
    return this.templates.remove(id);
  }
}
