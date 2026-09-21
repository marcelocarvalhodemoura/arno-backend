import { HttpException, HttpStatus } from '@nestjs/common';
import type { z, ZodTypeAny } from 'zod';

export function parseDto<S extends ZodTypeAny>(schema: S, data: unknown, fallbackMessage?: string): z.output<S> {
  const parsed = schema.safeParse(data);
  if (!parsed.success) {
    throw new HttpException({ error: fallbackMessage ?? parsed.error.flatten() }, HttpStatus.BAD_REQUEST);
  }
  return parsed.data;
}

export function fail(message: string, status: HttpStatus): never {
  throw new HttpException({ error: message }, status);
}
