import { expectedMonthlyFee, lateMonthlyFee, matchesMensalidadeAmount, onTimeMonthlyFee } from './fee-table';

describe('fee table', () => {
  it('uses the poster amounts for non-members and club members', () => {
    expect(onTimeMonthlyFee({ branch: 'escoteiro', clubeLtc: false })).toBe(89.5);
    expect(lateMonthlyFee({ branch: 'escoteiro', clubeLtc: false })).toBe(99.5);
    expect(onTimeMonthlyFee({ branch: 'pioneiro', clubeLtc: false })).toBe(39.5);
    expect(lateMonthlyFee({ branch: 'pioneiro', clubeLtc: false })).toBe(49.5);
    expect(onTimeMonthlyFee({ branch: 'escoteiro', clubeLtc: true })).toBe(75);
    expect(lateMonthlyFee({ branch: 'escoteiro', clubeLtc: true })).toBe(75);
    expect(onTimeMonthlyFee({ branch: 'pioneiro', clubeLtc: true })).toBe(25);
    expect(lateMonthlyFee({ branch: 'pioneiro', clubeLtc: true })).toBe(25);
  });

  it('does not charge dirigentes, escotistas or Clube da Flor de Lis', () => {
    expect(onTimeMonthlyFee({ branch: 'escoteiro', role: 'escotista', clubeLtc: false })).toBe(0);
    expect(lateMonthlyFee({ branch: 'escoteiro', role: 'dirigente', clubeLtc: false })).toBe(0);
    expect(onTimeMonthlyFee({ branch: 'lobinho', role: 'clube', clubeLtc: true })).toBe(0);
    expect(onTimeMonthlyFee({ branch: 'flor-de-lis', role: 'jovem', clubeLtc: false })).toBe(0);
    expect(lateMonthlyFee({ branch: 'flor-de-lis', role: 'jovem', clubeLtc: true })).toBe(0);
    expect(onTimeMonthlyFee({ branch: 'escoteiro', role: 'jovem', clubeLtc: false })).toBe(89.5);
  });

  it('raises the amount after the 10th', () => {
    const profile = { branch: 'lobinho' as const, clubeLtc: false };
    expect(expectedMonthlyFee(profile, '2026-09-10', '2026-09-10')).toBe(89.5);
    expect(expectedMonthlyFee(profile, '2026-09-10', '2026-09-11')).toBe(99.5);
    expect(matchesMensalidadeAmount(profile, 89.5)).toBe(true);
    expect(matchesMensalidadeAmount(profile, 99.5)).toBe(true);
    expect(matchesMensalidadeAmount(profile, 75)).toBe(false);
  });
});
