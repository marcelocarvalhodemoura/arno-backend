import { assertNoMassDelete, countChanges, diffFinanceRows, emptyRows, type FinanceRows } from './finance-writer';

function rows(partial: Partial<FinanceRows>): FinanceRows {
  return { ...emptyRows(), ...partial };
}

describe('finance-writer', () => {
  it('separa inserções, atualizações e remoções por chave', () => {
    const before = rows({
      member: [
        { id: 'a', name: 'Ana' },
        { id: 'b', name: 'Bia' },
      ],
      monthClosing: [{ yearMonth: '2026-01', income: 10 }],
    });
    const after = rows({
      member: [
        { id: 'a', name: 'Ana' },
        { id: 'b', name: 'Beatriz' },
        { id: 'c', name: 'Caio' },
      ],
      monthClosing: [],
    });
    const changes = diffFinanceRows(before, after);
    expect(changes.member.insert.map((row) => row.id)).toEqual(['c']);
    expect(changes.member.update.map((row) => row.id)).toEqual(['b']);
    expect(changes.member.remove).toEqual([]);
    expect(changes.monthClosing.remove).toEqual(['2026-01']);
    expect(countChanges(changes)).toBe(3);
  });

  it('não vê mudança quando só a ordem das chaves ou as datas iguais diferem', () => {
    const before = rows({ transaction: [{ id: 't', amount: 1, date: new Date('2026-01-01T00:00:00Z') }] });
    const after = rows({ transaction: [{ date: new Date('2026-01-01T00:00:00Z'), amount: 1, id: 't' }] });
    expect(countChanges(diffFinanceRows(before, after))).toBe(0);
  });

  it('trata configurações como linha única', () => {
    const changes = diffFinanceRows(
      rows({ settings: [{ groupName: 'A', mensalidadeDueDay: 10 }] }),
      rows({ settings: [{ groupName: 'A', mensalidadeDueDay: 15 }] }),
    );
    expect(changes.settings.update).toHaveLength(1);
  });

  it('recusa apagar mais da metade de uma tabela grande', () => {
    const many = Array.from({ length: 40 }, (_, index) => ({ id: String(index) }));
    const before = rows({ member: many });
    const wiped = diffFinanceRows(before, rows({ member: [] }));
    expect(() => assertNoMassDelete(before, wiped)).toThrow('apagaria 40 de 40 linhas de member');

    const few = diffFinanceRows(before, rows({ member: many.slice(5) }));
    expect(() => assertNoMassDelete(before, few)).not.toThrow();
  });
});
