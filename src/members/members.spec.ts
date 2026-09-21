import { assertYouthGuardians, cleanedGuardians, createMember } from './members';
import type { DatabaseShape } from '../shared/types';

function emptyDb(): DatabaseShape {
  return {
    members: [],
    memberGuardians: [],
    memberAccounts: [],
    movementTypes: [],
    fees: [],
    projects: [],
    transactions: [],
    settings: { openingBalance: 0, groupName: 'Arno' },
  };
}

describe('members', () => {
  it('requires a guardian for a youth', () => {
    expect(() => assertYouthGuardians('jovem', 0)).toThrow(/responsável/);
    expect(() => assertYouthGuardians('escotista', 0)).not.toThrow();
  });

  it('trims and drops empty guardians', () => {
    expect(
      cleanedGuardians([
        { name: '  Helena Souza  ', relationship: 'Mãe', phone: ' 51 ', email: '' },
        { name: 'X', relationship: 'Pai' },
      ]),
    ).toEqual([{ id: undefined, name: 'Helena Souza', relationship: 'Mãe', phone: '51', email: '' }]);
  });

  it('creates a youth with official fee and a guardian', () => {
    const db = emptyDb();
    const member = createMember(
      db,
      {
        name: 'Ana Souza',
        email: 'ana@example.com',
        phone: '51999990000',
        branch: 'escoteiro',
        role: 'jovem',
        joinedAt: '2026-03-01',
        clubeLtc: true,
        guardians: [{ name: 'Helena Souza', relationship: 'Mãe' }],
      },
      'u1',
    );
    expect(member.monthlyFee).toBe(75);
    expect(db.memberGuardians).toHaveLength(1);
  });

  it('rejects a youth without guardians', () => {
    const db = emptyDb();
    expect(() =>
      createMember(
        db,
        {
          name: 'Ana Souza',
          email: 'ana@example.com',
          phone: '51999990000',
          branch: 'escoteiro',
          role: 'jovem',
          joinedAt: '2026-03-01',
          clubeLtc: false,
        },
        'u1',
      ),
    ).toThrow(/responsável/);
  });
});
