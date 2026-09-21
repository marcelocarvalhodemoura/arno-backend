import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBody, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../shared/auth/current-user.decorator';
import { Roles } from '../shared/auth/roles.decorator';
import type { AuthPayload } from '../shared/auth/token';
import { ApiAdmin, ApiAuth } from '../shared/swagger/api-auth.decorator';
import { ProjectsService } from './projects.service';

@ApiTags('Projetos')
@Controller('api')
export class ProjectsController {
  constructor(private readonly projects: ProjectsService) {}

  @Get('projects')
  @ApiAuth()
  @ApiOperation({ summary: 'Listar projetos' })
  @ApiQuery({ name: 'year', required: false, example: '2026' })
  @ApiQuery({ name: 'branch', required: false, example: 'grupo' })
  list(@Query('year') year?: string, @Query('branch') branch?: string) {
    return this.projects.list(year, branch);
  }

  @Roles('admin')
  @Post('projects')
  @ApiAdmin()
  @ApiOperation({ summary: 'Criar projeto' })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['branch', 'year', 'name'],
      properties: {
        branch: { type: 'string', example: 'escoteiro' },
        year: { type: 'integer', example: 2026 },
        name: { type: 'string', example: 'Jamboree 2026' },
        description: { type: 'string' },
        items: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              category: { type: 'string' },
              description: { type: 'string' },
              planned: { type: 'number' },
              movementTypeId: { type: 'string' },
            },
          },
        },
      },
    },
  })
  create(@Body() body: unknown, @CurrentUser() auth: AuthPayload) {
    return this.projects.create(body, auth.userId);
  }

  @Roles('admin')
  @Patch('projects/:id')
  @ApiAdmin()
  @ApiOperation({
    summary: 'Atualizar projeto',
    description: 'Enviar items substitui o orçamento (ids existentes são reaproveitados).',
  })
  update(@Param('id') id: string, @Body() body: unknown, @CurrentUser() auth: AuthPayload) {
    return this.projects.update(id, body, auth.userId);
  }
}
