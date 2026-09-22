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
        {
          name: '  Helena Souza  ',
          relationship: 'Mãe',
          phone: ' 51 ',
          email: '',
        },
        { name: 'X', relationship: 'Pai' },
      ]),
    ).toEqual([
      {
        id: undefined,
        name: 'Helena Souza',
        relationship: 'Mãe',
        phone: '51',
        email: '',
      },
    ]);
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
    expect(member.feeOverride).toBeNull();
    expect(db.memberGuardians).toHaveLength(1);
  });

  it('stores a fee override for sibling or chief-child discounts', () => {
    const db = emptyDb();
    const member = createMember(
      db,
      {
        name: 'Caio Dias',
        email: 'caio@example.com',
        phone: '51999990004',
        branch: 'escoteiro',
        role: 'jovem',
        joinedAt: '2026-03-01',
        clubeLtc: false,
        feeOverride: 82,
        guardians: [{ name: 'Lia Dias', relationship: 'Mãe' }],
      },
      'u1',
    );
    expect(member.feeOverride).toBe(82);
    expect(member.monthlyFee).toBe(82);
  });

  it('does not charge dirigentes, escotistas or Clube da Flor de Lis', () => {
    const db = emptyDb();
    const escotista = createMember(
      db,
      {
        name: 'Bia Lima',
        email: 'bia@example.com',
        phone: '51999990001',
        branch: 'escoteiro',
        role: 'escotista',
        joinedAt: '2026-03-01',
        clubeLtc: false,
      },
      'u1',
    );
    const dirigente = createMember(
      db,
      {
        name: 'Caio Dias',
        email: 'caio@example.com',
        phone: '51999990002',
        branch: 'senior',
        role: 'dirigente',
        joinedAt: '2026-03-01',
        clubeLtc: false,
      },
      'u1',
    );
    const clube = createMember(
      db,
      {
        name: 'Duda Nunes',
        email: 'duda@example.com',
        phone: '51999990003',
        branch: 'flor-de-lis',
        role: 'clube',
        joinedAt: '2026-03-01',
        clubeLtc: true,
      },
      'u1',
    );
    expect(escotista.monthlyFee).toBe(0);
    expect(dirigente.monthlyFee).toBe(0);
    expect(clube.monthlyFee).toBe(0);
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
