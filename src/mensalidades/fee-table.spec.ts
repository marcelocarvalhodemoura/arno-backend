import type { FeeSchedulePeriod } from '../shared/types';
import {
  DEFAULT_FEE_SCHEDULE,
  expectedMensalidadeAmount,
  lateMonthlyFee,
  matchesMensalidadeAmount,
  mensalidadeFormula,
  mensalidadeShares,
  onTimeMonthlyFee,
  periodFor,
  specialFamilyFee,
} from './fee-table';

describe('fee table', () => {
  it('breaks the month into parts, with dilution and late fee kept apart from the group share', () => {
    const regular = { branch: 'escoteiro', clubeLtc: false };
    expect(mensalidadeFormula(regular, '2026-05-10', { late: false, clubFeeIncluded: true })).toEqual({
      source: 'table',
      group: 43,
      branch: 8,
      snack: 24,
      club: 10,
      dilution: 4.5,
      lateFee: 0,
      total: 89.5,
      pendingSplit: false,
    });
    expect(mensalidadeFormula(regular, '2026-05-10', { late: true, clubFeeIncluded: true })).toMatchObject({
      club: 20,
      total: 99.5,
    });
    expect(mensalidadeFormula(regular, '2026-05-10', { late: true, clubFeeIncluded: false })).toMatchObject({
      club: 0,
      dilution: 0,
      total: 75,
    });
    expect(
      mensalidadeFormula({ branch: 'pioneiro' }, '2026-03-10', { late: true, clubFeeIncluded: true }),
    ).toMatchObject({ group: 10, branch: 5, lateFee: 5, total: 20, pendingSplit: true });
    expect(
      mensalidadeFormula({ branch: 'escoteiro', feeOverride: 82 }, '2026-06-10', { late: true, clubFeeIncluded: true }),
    ).toMatchObject({ source: 'family', group: 74, branch: 8, lateFee: 0, total: 82, pendingSplit: true });
    expect(
      mensalidadeFormula({ branch: 'escoteiro', feeOverride: 50 }, '2026-06-10', {
        late: false,
        clubFeeIncluded: true,
      }),
    ).toMatchObject({ source: 'custom', group: 42, branch: 8, total: 50 });
  });

  it('uses the poster amounts for non-members and club members (maio–nov)', () => {
    expect(onTimeMonthlyFee({ branch: 'escoteiro', clubeLtc: false })).toBe(89.5);
    expect(lateMonthlyFee({ branch: 'escoteiro', clubeLtc: false })).toBe(99.5);
    expect(onTimeMonthlyFee({ branch: 'pioneiro', clubeLtc: false })).toBe(39.5);
    expect(lateMonthlyFee({ branch: 'pioneiro', clubeLtc: false })).toBe(49.5);
    expect(onTimeMonthlyFee({ branch: 'escoteiro', clubeLtc: true })).toBe(75);
    expect(lateMonthlyFee({ branch: 'escoteiro', clubeLtc: true })).toBe(75);
    expect(onTimeMonthlyFee({ branch: 'pioneiro', clubeLtc: true })).toBe(25);
    expect(lateMonthlyFee({ branch: 'pioneiro', clubeLtc: true })).toBe(25);
  });

  it('uses the early-season totals for março and abril', () => {
    expect(onTimeMonthlyFee({ branch: 'escoteiro', clubeLtc: false }, '2026-03')).toBe(60);
    expect(lateMonthlyFee({ branch: 'escoteiro', clubeLtc: false }, '2026-03')).toBe(60);
    expect(onTimeMonthlyFee({ branch: 'escoteiro', clubeLtc: true }, '2026-04')).toBe(60);
    expect(onTimeMonthlyFee({ branch: 'pioneiro', clubeLtc: false }, '2026-03')).toBe(15);
    expect(lateMonthlyFee({ branch: 'pioneiro', clubeLtc: false }, '2026-03')).toBe(20);
    expect(lateMonthlyFee({ branch: 'pioneiro', clubeLtc: true }, '2026-04')).toBe(20);
    expect(expectedMensalidadeAmount({ branch: 'escoteiro', clubeLtc: false }, '2026-03-10', '2026-03-20', true)).toBe(
      60,
    );
    expect(expectedMensalidadeAmount({ branch: 'pioneiro', clubeLtc: false }, '2026-04-10', '2026-04-01', true)).toBe(
      15,
    );
    expect(expectedMensalidadeAmount({ branch: 'pioneiro', clubeLtc: false }, '2026-03-10', '2026-03-20', true)).toBe(
      20,
    );
    expect(expectedMensalidadeAmount({ branch: 'pioneiro', clubeLtc: false }, '2026-04-10', '2026-04-15', false)).toBe(
      20,
    );
    expect(matchesMensalidadeAmount({ branch: 'pioneiro', clubeLtc: false }, 20)).toBe(true);
  });

  it('does not charge dirigentes, escotistas or Clube da Flor de Lis', () => {
    expect(onTimeMonthlyFee({ branch: 'escoteiro', role: 'escotista', clubeLtc: false })).toBe(0);
    expect(lateMonthlyFee({ branch: 'escoteiro', role: 'dirigente', clubeLtc: false })).toBe(0);
    expect(onTimeMonthlyFee({ branch: 'lobinho', role: 'clube', clubeLtc: true })).toBe(0);
    expect(onTimeMonthlyFee({ branch: 'flor-de-lis', role: 'jovem', clubeLtc: false })).toBe(0);
    expect(lateMonthlyFee({ branch: 'flor-de-lis', role: 'jovem', clubeLtc: true })).toBe(0);
    expect(onTimeMonthlyFee({ branch: 'escoteiro', role: 'jovem', clubeLtc: false })).toBe(89.5);
    // Nenhum valor conta como mensalidade de quem não paga (nem o monthlyFee antigo do cadastro).
    expect(matchesMensalidadeAmount({ branch: 'lobinho', role: 'escotista', monthlyFee: 60 }, 60)).toBe(false);
    expect(matchesMensalidadeAmount({ branch: 'escoteiro', role: 'dirigente' }, 89.5)).toBe(false);
    expect(matchesMensalidadeAmount({ branch: 'flor-de-lis', role: 'jovem' }, 60)).toBe(false);
    expect(matchesMensalidadeAmount({ branch: 'lobinho', role: 'clube' }, 60)).toBe(false);
  });

  it('adds or removes the club package down to the group base from maio', () => {
    const profile = { branch: 'escoteiro' as const, clubeLtc: false };
    expect(expectedMensalidadeAmount(profile, '2026-09-10', '2026-09-10', true)).toBe(89.5);
    expect(expectedMensalidadeAmount(profile, '2026-09-10', '2026-09-10', false)).toBe(75);
    expect(expectedMensalidadeAmount(profile, '2026-09-10', '2026-09-11', true)).toBe(99.5);
    expect(expectedMensalidadeAmount(profile, '2026-09-10', '2026-09-11', false)).toBe(75);
    expect(expectedMensalidadeAmount({ branch: 'pioneiro', clubeLtc: false }, '2026-09-10', '2026-09-10', true)).toBe(
      39.5,
    );
    expect(expectedMensalidadeAmount({ branch: 'pioneiro', clubeLtc: false }, '2026-09-10', '2026-09-10', false)).toBe(
      25,
    );
    expect(expectedMensalidadeAmount({ branch: 'escoteiro', clubeLtc: true }, '2026-09-10', '2026-09-10', false)).toBe(
      75,
    );
    expect(expectedMensalidadeAmount({ branch: 'escoteiro', clubeLtc: true }, '2026-09-10', '2026-09-10', true)).toBe(
      89.5,
    );
    expect(expectedMensalidadeAmount({ branch: 'escoteiro', clubeLtc: true }, '2026-09-10', '2026-09-11', true)).toBe(
      99.5,
    );
    expect(expectedMensalidadeAmount(profile, '2026-04-10', '2026-04-01', false)).toBe(60);
    expect(matchesMensalidadeAmount(profile, 75)).toBe(true);
    expect(matchesMensalidadeAmount(profile, 60)).toBe(true);
  });

  it('uses fixed special-family fees (82 não sócio / 67,50 sócio)', () => {
    expect(specialFamilyFee(false)).toBe(82);
    expect(specialFamilyFee(true)).toBe(67.5);

    const nonMember = { branch: 'escoteiro' as const, clubeLtc: false, feeOverride: 82 };
    expect(onTimeMonthlyFee(nonMember)).toBe(82);
    expect(lateMonthlyFee(nonMember)).toBe(82);
    expect(onTimeMonthlyFee(nonMember, '2026-03')).toBe(60);
    expect(expectedMensalidadeAmount(nonMember, '2026-05-10', '2026-05-20', true)).toBe(82);
    expect(expectedMensalidadeAmount(nonMember, '2026-05-10', '2026-05-20', false)).toBe(82);
    expect(matchesMensalidadeAmount(nonMember, 82)).toBe(true);

    const member = { branch: 'escoteiro' as const, clubeLtc: true, feeOverride: 82 };
    expect(onTimeMonthlyFee(member)).toBe(67.5);
    expect(lateMonthlyFee(member)).toBe(67.5);
    expect(expectedMensalidadeAmount(member, '2026-05-10', '2026-05-20', true)).toBe(67.5);
    expect(expectedMensalidadeAmount(member, '2026-05-10', '2026-05-20', false)).toBe(67.5);
    expect(matchesMensalidadeAmount(member, 67.5)).toBe(true);
  });

  it('keeps the current table after abril in later years (vigência por data, não por mês)', () => {
    const profile = { branch: 'escoteiro' as const, clubeLtc: false };
    expect(onTimeMonthlyFee(profile, '2027-03')).toBe(89.5);
    expect(onTimeMonthlyFee({ branch: 'pioneiro', clubeLtc: false }, '2027-04')).toBe(39.5);
    expect(periodFor(DEFAULT_FEE_SCHEDULE, '2027-03').startMonth).toBe('2026-05');
  });

  it('splits the mensalidade into grupo, caixinha, lanche and clube', () => {
    const regular = { branch: 'escoteiro' as const, clubeLtc: false };
    expect(mensalidadeShares(regular, '2026-09-10', { late: false, clubFeeIncluded: true })).toMatchObject({
      group: 47.5,
      branch: 8,
      snack: 24,
      club: 10,
      total: 89.5,
    });
    expect(mensalidadeShares(regular, '2026-09-10', { late: true, clubFeeIncluded: true })).toMatchObject({
      club: 20,
      total: 99.5,
    });
    expect(mensalidadeShares(regular, '2026-03-10', { late: false, clubFeeIncluded: true })).toMatchObject({
      group: 35,
      branch: 5,
      snack: 20,
      club: 0,
      total: 60,
    });
    expect(
      mensalidadeShares({ branch: 'pioneiro', clubeLtc: true }, '2026-09-10', { late: false, clubFeeIncluded: false }),
    ).toMatchObject({ group: 20, branch: 5, snack: 0, club: 0, total: 25 });
  });

  it('applies a short adjustment period inside an open-ended one', () => {
    const [, current] = DEFAULT_FEE_SCHEDULE;
    const adjustment: FeeSchedulePeriod = {
      ...current,
      id: 'adj',
      startMonth: '2026-07',
      endMonth: '2026-08',
      regular: { ...current.regular, snack: 30 },
    };
    const schedule = [...DEFAULT_FEE_SCHEDULE, adjustment];
    const profile = { branch: 'escoteiro' as const, clubeLtc: true };
    expect(onTimeMonthlyFee(profile, '2026-06', schedule)).toBe(75);
    expect(onTimeMonthlyFee(profile, '2026-07', schedule)).toBe(81);
    expect(onTimeMonthlyFee(profile, '2026-08', schedule)).toBe(81);
    expect(onTimeMonthlyFee(profile, '2026-09', schedule)).toBe(75);
  });

  it('follows a changed special-family value without rewriting the cadastro', () => {
    const [early, current] = DEFAULT_FEE_SCHEDULE;
    const next: FeeSchedulePeriod = {
      ...current,
      id: 'next',
      startMonth: '2027-03',
      familyNonMember: { ...current.familyNonMember!, group: 77 },
    };
    const schedule = [early, current, next];
    const sibling = { branch: 'escoteiro' as const, clubeLtc: false, feeOverride: 82 };
    expect(onTimeMonthlyFee(sibling, '2026-09', schedule)).toBe(82);
    expect(onTimeMonthlyFee(sibling, '2027-05', schedule)).toBe(85);
    expect(specialFamilyFee(false, schedule, '2027-05')).toBe(85);
  });
});
