import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../shared/auth/public.decorator';

@ApiTags('Saúde e autenticação')
@Controller('api')
export class HealthController {
  @Public()
  @Get('health')
  @ApiOperation({ summary: 'Health check' })
  @ApiOkResponse({ description: 'API no ar' })
  health() {
    return { ok: true, service: 'arno-financeiro' };
  }
}
