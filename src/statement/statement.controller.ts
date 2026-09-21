import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { CurrentUser } from '../shared/auth/current-user.decorator';
import type { AuthPayload } from '../shared/auth/token';
import { StatementService } from './statement.service';

@Controller('api/integrations')
export class StatementController {
  constructor(private readonly statement: StatementService) {}

  @Post('interpret-statement')
  @HttpCode(HttpStatus.OK)
  interpret(@Body() body: unknown, @CurrentUser() auth: AuthPayload) {
    return this.statement.interpret(body, auth.userId);
  }

  @Post('map-import')
  @HttpCode(HttpStatus.OK)
  mapImport(@Body() body: unknown) {
    return this.statement.mapImport(body);
  }

  @Post('transactions')
  @HttpCode(HttpStatus.OK)
  ingest(@Body() body: unknown, @CurrentUser() auth: AuthPayload) {
    return this.statement.ingest(body, auth.userId);
  }
}
