import type { DatabaseShape } from '../types';

export interface DomainEvent {
  readonly type: string;
}

/** Quem reage a um evento recebe também o financeiro em memória da gravação em andamento. */
export type DomainEventHandler<E extends DomainEvent> = (event: E, db: DatabaseShape) => void;

/**
 * Eventos de domínio síncronos e em memória: o handler roda dentro da mesma gravação de quem publicou,
 * então ou tudo é gravado junto ou nada é. Quem publica não conhece quem reage.
 */
export class DomainEvents {
  private readonly handlers = new Map<string, DomainEventHandler<DomainEvent>[]>();

  on<E extends DomainEvent>(type: E['type'], handler: DomainEventHandler<E>): () => void {
    const list = this.handlers.get(type) ?? [];
    list.push(handler as DomainEventHandler<DomainEvent>);
    this.handlers.set(type, list);
    return () => {
      const current = this.handlers.get(type) ?? [];
      this.handlers.set(
        type,
        current.filter((item) => item !== (handler as DomainEventHandler<DomainEvent>)),
      );
    };
  }

  publish(events: DomainEvent | DomainEvent[], db: DatabaseShape): void {
    for (const event of Array.isArray(events) ? events : [events]) {
      for (const handler of this.handlers.get(event.type) ?? []) handler(event, db);
    }
  }
}

export const domainEvents = new DomainEvents();
