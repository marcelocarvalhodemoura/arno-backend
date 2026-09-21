import { HttpException, HttpStatus } from '@nestjs/common';
import { z } from 'zod';
import { fail, parseDto } from './api';
import { errorMessage, isUniqueUserConflict } from './errors';

describe('parseDto', () => {
  const schema = z.object({ name: z.string().min(2) });

  it('returns parsed data', () => {
    expect(parseDto(schema, { name: 'Doação' })).toEqual({ name: 'Doação' });
  });

  it('throws 400 with flatten when invalid', () => {
    expect(() => parseDto(schema, { name: 'A' })).toThrow(HttpException);
    try {
      parseDto(schema, { name: 'A' });
    } catch (error) {
      expect((error as HttpException).getStatus()).toBe(HttpStatus.BAD_REQUEST);
    }
  });
});

describe('fail', () => {
  it('throws an HttpException with { error }', () => {
    try {
      fail('Não autorizado', HttpStatus.UNAUTHORIZED);
    } catch (error) {
      expect(error).toBeInstanceOf(HttpException);
      expect((error as HttpException).getStatus()).toBe(401);
      expect((error as HttpException).getResponse()).toEqual({
        error: 'Não autorizado',
      });
    }
  });
});

describe('http errors', () => {
  it('reads Error messages and detects unique conflicts', () => {
    expect(errorMessage(new Error('boom'), 'fallback')).toBe('boom');
    expect(errorMessage('x', 'fallback')).toBe('fallback');
    expect(isUniqueUserConflict('duplicate key users_email')).toBe(true);
    expect(isUniqueUserConflict('ok')).toBe(false);
  });
});
