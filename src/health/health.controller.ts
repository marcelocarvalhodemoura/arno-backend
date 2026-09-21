import { Controller, Get } from '@nestjs/common';
import { Public } from '../shared/auth/public.decorator';

@Controller('api')
export class HealthController {
  @Public()
  @Get('health')
  health() {
    return { ok: true, service: 'arno-financeiro' };
  }
}
