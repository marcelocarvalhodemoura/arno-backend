import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import { ApiBody, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../shared/auth/current-user.decorator';
import { Roles } from '../shared/auth/roles.decorator';
import type { AuthPayload } from '../shared/auth/token';
import { ApiAuth } from '../shared/swagger/api-auth.decorator';
import { BarterService } from './barter.service';

const planInput = {
  memberId: { type: 'string', description: 'Jovem da família que recebe o abatimento (irmãos entram junto)' },
  amount: { type: 'number', example: 300 },
  serviceDate: { type: 'string', example: '2026-11-10' },
};

@ApiTags('Permutas')
@ApiAuth()
@Controller('api/permutas')
export class BarterController {
  constructor(private readonly barter: BarterService) {}

  @Get()
  @ApiOperation({
    summary: 'Permutas registradas',
    description: 'As pendentes trazem a prévia atual: mensalidades que serão abatidas e quanto vira doação.',
  })
  list() {
    return this.barter.list();
  }

  @Post('previa')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Prévia da permuta',
    description:
      'Meses inteiros em aberto da família, do mais antigo ao mais novo, no valor pontual. O que não fecha um mês vira doação.',
  })
  @ApiBody({ schema: { type: 'object', required: ['amount', 'serviceDate'], properties: planInput } })
  preview(@Body() body: unknown) {
    return this.barter.preview(body);
  }

  @Post()
  @ApiOperation({
    summary: 'Registrar permuta (aguarda a diretoria)',
    description: 'Nada entra no caixa até um admin aprovar.',
  })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['donorName', 'service', 'amount', 'serviceDate', 'expenseTypeId', 'donationTypeId'],
      properties: {
        ...planInput,
        donorName: { type: 'string', example: 'Pai do Bruno' },
        service: { type: 'string', example: 'Conserto do telhado da sede' },
        expenseTypeId: { type: 'string', description: 'Tipo da despesa do serviço' },
        donationTypeId: { type: 'string', description: 'Tipo da entrada da sobra (doação)' },
        notes: { type: 'string' },
      },
    },
  })
  create(@Body() body: unknown, @CurrentUser() auth: AuthPayload) {
    return this.barter.create(body, auth.userId);
  }

  @Post(':id/aprovar')
  @Roles('admin')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Aprovar permuta (diretoria)',
    description: 'Baixa as mensalidades, lança a doação e a despesa do serviço, tudo com meio permuta.',
  })
  @ApiBody({ schema: { type: 'object', properties: { note: { type: 'string' } } } })
  approve(@Param('id') id: string, @Body() body: unknown, @CurrentUser() auth: AuthPayload) {
    return this.barter.approve(id, body, auth.userId);
  }

  @Post(':id/recusar')
  @Roles('admin')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Recusar permuta (diretoria)' })
  @ApiBody({ schema: { type: 'object', required: ['note'], properties: { note: { type: 'string' } } } })
  reject(@Param('id') id: string, @Body() body: unknown, @CurrentUser() auth: AuthPayload) {
    return this.barter.reject(id, body, auth.userId);
  }
}
