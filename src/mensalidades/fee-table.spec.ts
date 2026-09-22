import { expectedMensalidadeAmount, lateMonthlyFee, matchesMensalidadeAmount, onTimeMonthlyFee } from './fee-table';

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

  it('adds or removes the club share per month only from maio', () => {
    const profile = { branch: 'escoteiro' as const, clubeLtc: false };
    expect(expectedMensalidadeAmount(profile, '2026-09-10', '2026-09-10', true)).toBe(89.5);
    expect(expectedMensalidadeAmount(profile, '2026-09-10', '2026-09-10', false)).toBe(69.5);
    expect(expectedMensalidadeAmount(profile, '2026-09-10', '2026-09-11', false)).toBe(79.5);
    expect(expectedMensalidadeAmount({ branch: 'pioneiro', clubeLtc: false }, '2026-09-10', '2026-09-10', false)).toBe(
      39.5,
    );
    expect(expectedMensalidadeAmount({ branch: 'escoteiro', clubeLtc: true }, '2026-09-10', '2026-09-10', false)).toBe(
      75,
    );
    expect(expectedMensalidadeAmount({ branch: 'escoteiro', clubeLtc: true }, '2026-09-10', '2026-09-10', true)).toBe(
      95,
    );
    expect(expectedMensalidadeAmount(profile, '2026-04-10', '2026-04-01', false)).toBe(60);
    expect(matchesMensalidadeAmount(profile, 69.5)).toBe(true);
    expect(matchesMensalidadeAmount(profile, 60)).toBe(true);
  });

  it('uses a fixed fee override from maio (filho de chefe / irmão)', () => {
    const profile = { branch: 'escoteiro' as const, clubeLtc: false, feeOverride: 82 };
    expect(onTimeMonthlyFee(profile)).toBe(82);
    expect(lateMonthlyFee(profile)).toBe(82);
    expect(onTimeMonthlyFee(profile, 3)).toBe(60);
    expect(expectedMensalidadeAmount(profile, '2026-05-10', '2026-05-20', true)).toBe(82);
    expect(expectedMensalidadeAmount(profile, '2026-05-10', '2026-05-20', false)).toBe(82);
    expect(matchesMensalidadeAmount(profile, 82)).toBe(true);
  });
});
