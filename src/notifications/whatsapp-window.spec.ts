import { isInsideWindow, isOutsideWindowError, windowKey } from './whatsapp-window';

describe('janela de 24 h do WhatsApp', () => {
  it('stores Brazilian mobiles without the ninth digit', () => {
    expect(windowKey('(51) 99999-1002')).toBe('555199991002');
    expect(windowKey('555199991002')).toBe('555199991002');
    expect(windowKey('5551999991002')).toBe('555199991002');
  });

  it('is open only within 24 h (minus a safety margin) of the last inbound message', () => {
    const now = Date.parse('2026-10-05T12:00:00.000Z');
    expect(isInsideWindow(null, now)).toBe(false);
    expect(isInsideWindow(new Date('2026-10-05T08:00:00.000Z'), now)).toBe(true);
    expect(isInsideWindow(new Date('2026-10-04T12:20:00.000Z'), now)).toBe(true);
    expect(isInsideWindow(new Date('2026-10-04T12:05:00.000Z'), now)).toBe(false);
    expect(isInsideWindow(new Date('2026-10-03T12:00:00.000Z'), now)).toBe(false);
  });

  it('recognizes the Graph API re-engagement error', () => {
    expect(isOutsideWindowError('{"error":{"code":131047,"message":"Re-engagement message"}}')).toBe(true);
    expect(isOutsideWindowError('{"error":{"code":190,"message":"Session has expired"}}')).toBe(false);
  });
});
