import type { DatabaseShape } from '../types';
import { DomainEvents } from './domain-events';

describe('DomainEvents', () => {
  it('entrega cada evento aos handlers do tipo, na ordem de inscrição', () => {
    const bus = new DomainEvents();
    const seen: string[] = [];
    bus.on<{ type: 'a'; n: number }>('a', (event) => seen.push(`1:${event.n}`));
    const off = bus.on<{ type: 'a'; n: number }>('a', (event) => seen.push(`2:${event.n}`));
    bus.on('b', () => seen.push('b'));
    bus.publish([{ type: 'a', n: 1 } as { type: 'a'; n: number }], {} as DatabaseShape);
    off();
    bus.publish({ type: 'a', n: 2 } as { type: 'a'; n: number }, {} as DatabaseShape);
    expect(seen).toEqual(['1:1', '2:1', '1:2']);
  });
});
