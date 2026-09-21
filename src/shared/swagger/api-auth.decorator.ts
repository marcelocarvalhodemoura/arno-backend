import { applyDecorators } from '@nestjs/common';
import { ApiBearerAuth, ApiForbiddenResponse, ApiUnauthorizedResponse } from '@nestjs/swagger';

export const SWAGGER_BEARER = 'access-token';

export function ApiAuth() {
  return applyDecorators(ApiBearerAuth(SWAGGER_BEARER), ApiUnauthorizedResponse({ description: 'Não autorizado' }));
}

export function ApiAdmin() {
  return applyDecorators(ApiAuth(), ApiForbiddenResponse({ description: 'Exclusivo do perfil admin' }));
}
