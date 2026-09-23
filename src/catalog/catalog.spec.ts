import { createFee, createMovementType, deleteFee, patchSettings, updateMovementType } from './catalog';
import type { DatabaseShape } from '../shared/types';

function emptyDb(): DatabaseShape {
  return {
    members: [],
    memberGuardians: [],
    memberSiblings: [],
    memberAccounts: [],
    movementTypes: [],
    fees: [],
    projects: [],
    transactions: [],
    settings: { openingBalance: 0, groupName: 'Arno', mensalidadeDueDay: 10 },
  };
}

describe('catalog', () => {
  it('creates and updates a movement type', () => {
    const db = emptyDb();
    const created = createMovementType(db, { name: 'Doação', direction: 'income', pixKey: 'abc' }, 'u1');
    expect(created.branch).toBe('grupo');
    expect(created.pixKey).toBe('abc');
    expect(() => createMovementType(db, { name: 'doação', direction: 'income' }, 'u1')).toThrow(/já cadastrado/);
    const updated = updateMovementType(db, created.id, { branch: 'escoteiro', pixKey: ' 99 ' }, 'u1');
    expect(updated?.branch).toBe('escoteiro');
    expect(updated?.pixKey).toBe('99');
  });

  it('creates, updates and deletes fees', () => {
    const db = emptyDb();
    const fee = createFee(db, { name: 'Acampamento', amount: 32.555 }, 'u1');
    expect(fee.amount).toBe(32.56);
    expect(() => createFee(db, { name: 'acampamento', amount: 1 }, 'u1')).toThrow(/já cadastrada/);
    expect(deleteFee(db, fee.id)).toBe(true);
    expect(deleteFee(db, fee.id)).toBe(false);
  });

  it('patches settings', () => {
    const db = emptyDb();
    const settings = patchSettings(db, { openingBalance: 10, groupName: 'Grupo Teste' }, 'u1');
    expect(settings.openingBalance).toBe(10);
    expect(settings.groupName).toBe('Grupo Teste');
  });
});
