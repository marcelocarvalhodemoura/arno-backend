import {
  assertFamilyDiscountXor,
  assertYouthGuardians,
  cleanedGuardians,
  createMember,
  siblingIdsOf,
  updateMember,
} from './members';
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
    expect(member.chiefChild).toBe(false);
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

  it('applies special fee for chief child', () => {
    const db = emptyDb();
    const member = createMember(
      db,
      {
        name: 'Leo Chefe',
        email: 'leo@example.com',
        phone: '51999990010',
        branch: 'escoteiro',
        role: 'jovem',
        joinedAt: '2026-03-01',
        clubeLtc: false,
        chiefChild: true,
        guardians: [{ name: 'Chefe', relationship: 'Pai' }],
      },
      'u1',
    );
    expect(member.chiefChild).toBe(true);
    expect(member.feeOverride).toBe(82);
    expect(member.monthlyFee).toBe(82);
  });

  it('links siblings bidirectionally and applies special fee to both', () => {
    const db = emptyDb();
    const older = createMember(
      db,
      {
        name: 'Ana Irmã',
        email: 'ana.irma@example.com',
        phone: '51999990011',
        branch: 'escoteiro',
        role: 'jovem',
        joinedAt: '2026-03-01',
        clubeLtc: false,
        guardians: [{ name: 'Mãe', relationship: 'Mãe' }],
      },
      'u1',
    );
    const younger = createMember(
      db,
      {
        name: 'Bruno Irmão',
        email: 'bruno.irmao@example.com',
        phone: '51999990012',
        branch: 'lobinho',
        role: 'jovem',
        joinedAt: '2026-03-01',
        clubeLtc: false,
        siblingIds: [older.id],
        guardians: [{ name: 'Mãe', relationship: 'Mãe' }],
      },
      'u1',
    );
    expect(siblingIdsOf(db, younger.id)).toEqual([older.id]);
    expect(siblingIdsOf(db, older.id)).toEqual([younger.id]);
    expect(younger.feeOverride).toBe(82);
    expect(older.feeOverride).toBe(82);
    expect(younger.monthlyFee).toBe(82);
    expect(older.monthlyFee).toBe(82);
  });

  it('rejects chief child together with siblings', () => {
    expect(() => assertFamilyDiscountXor(true, ['x'])).toThrow(/só uma opção/);
    const db = emptyDb();
    const other = createMember(
      db,
      {
        name: 'Outro',
        email: 'outro@example.com',
        phone: '51999990013',
        branch: 'escoteiro',
        role: 'jovem',
        joinedAt: '2026-03-01',
        clubeLtc: false,
        guardians: [{ name: 'Mãe', relationship: 'Mãe' }],
      },
      'u1',
    );
    expect(() =>
      createMember(
        db,
        {
          name: 'Conflito',
          email: 'conflito@example.com',
          phone: '51999990014',
          branch: 'escoteiro',
          role: 'jovem',
          joinedAt: '2026-03-01',
          clubeLtc: false,
          chiefChild: true,
          siblingIds: [other.id],
          guardians: [{ name: 'Mãe', relationship: 'Mãe' }],
        },
        'u1',
      ),
    ).toThrow(/só uma opção/);
  });

  it('clears special fee when siblings are removed', () => {
    const db = emptyDb();
    const a = createMember(
      db,
      {
        name: 'A',
        email: 'a@example.com',
        phone: '51999990015',
        branch: 'escoteiro',
        role: 'jovem',
        joinedAt: '2026-03-01',
        clubeLtc: false,
        guardians: [{ name: 'Mãe', relationship: 'Mãe' }],
      },
      'u1',
    );
    const b = createMember(
      db,
      {
        name: 'B',
        email: 'b@example.com',
        phone: '51999990016',
        branch: 'escoteiro',
        role: 'jovem',
        joinedAt: '2026-03-01',
        clubeLtc: false,
        siblingIds: [a.id],
        guardians: [{ name: 'Mãe', relationship: 'Mãe' }],
      },
      'u1',
    );
    updateMember(db, b.id, { siblingIds: [] }, 'u1');
    expect(siblingIdsOf(db, a.id)).toEqual([]);
    expect(siblingIdsOf(db, b.id)).toEqual([]);
    expect(a.feeOverride).toBeNull();
    expect(b.feeOverride).toBeNull();
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
