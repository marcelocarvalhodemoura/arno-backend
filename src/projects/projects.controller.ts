import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { CurrentUser } from '../shared/auth/current-user.decorator';
import { Roles } from '../shared/auth/roles.decorator';
import type { AuthPayload } from '../shared/auth/token';
import { ProjectsService } from './projects.service';

@Controller('api')
export class ProjectsController {
  constructor(private readonly projects: ProjectsService) {}

  @Get('projects')
  list(@Query('year') year?: string, @Query('branch') branch?: string) {
    return this.projects.list(year, branch);
  }

  @Roles('admin')
  @Post('projects')
  create(@Body() body: unknown, @CurrentUser() auth: AuthPayload) {
    return this.projects.create(body, auth.userId);
  }

  @Roles('admin')
  @Patch('projects/:id')
  update(@Param('id') id: string, @Body() body: unknown, @CurrentUser() auth: AuthPayload) {
    return this.projects.update(id, body, auth.userId);
  }
}
