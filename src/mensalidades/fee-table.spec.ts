import {
  expectedMensalidadeAmount,
  lateMonthlyFee,
  matchesMensalidadeAmount,
  onTimeMonthlyFee,
  specialFamilyFee,
} from './fee-table';

describe('fee table', () => {
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
    expect(onTimeMonthlyFee({ branch: 'escoteiro', clubeLtc: false }, 3)).toBe(60);
    expect(lateMonthlyFee({ branch: 'escoteiro', clubeLtc: false }, 3)).toBe(60);
    expect(onTimeMonthlyFee({ branch: 'escoteiro', clubeLtc: true }, 4)).toBe(60);
    expect(onTimeMonthlyFee({ branch: 'pioneiro', clubeLtc: false }, 3)).toBe(15);
    expect(lateMonthlyFee({ branch: 'pioneiro', clubeLtc: true }, 4)).toBe(15);
    expect(expectedMensalidadeAmount({ branch: 'escoteiro', clubeLtc: false }, '2026-03-10', '2026-03-20', true)).toBe(
      60,
    );
    expect(expectedMensalidadeAmount({ branch: 'pioneiro', clubeLtc: false }, '2026-04-10', '2026-04-01', true)).toBe(
      15,
    );
  });

  it('does not charge dirigentes, escotistas or Clube da Flor de Lis', () => {
    expect(onTimeMonthlyFee({ branch: 'escoteiro', role: 'escotista', clubeLtc: false })).toBe(0);
    expect(lateMonthlyFee({ branch: 'escoteiro', role: 'dirigente', clubeLtc: false })).toBe(0);
    expect(onTimeMonthlyFee({ branch: 'lobinho', role: 'clube', clubeLtc: true })).toBe(0);
    expect(onTimeMonthlyFee({ branch: 'flor-de-lis', role: 'jovem', clubeLtc: false })).toBe(0);
    expect(lateMonthlyFee({ branch: 'flor-de-lis', role: 'jovem', clubeLtc: true })).toBe(0);
    expect(onTimeMonthlyFee({ branch: 'escoteiro', role: 'jovem', clubeLtc: false })).toBe(89.5);
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
    expect(onTimeMonthlyFee(nonMember, 3)).toBe(60);
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
});
