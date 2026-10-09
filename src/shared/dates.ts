/** Datas como texto ISO (AAAA-MM-DD), no fuso de São Paulo quando dependem de "hoje". */

export function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

export function todayISO(now = new Date()): string {
  return now.toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
}

export function lastDayOfMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

/** Dia seguinte (ISO AAAA-MM-DD). */
export function dayAfterISO(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  const next = new Date(Date.UTC(y, m - 1, d + 1));
  return next.toISOString().slice(0, 10);
}

/** Primeiro dia do mês seguinte a `today`. */
export function nextMonthStart(today: string): string {
  const year = Number(today.slice(0, 4));
  const month = Number(today.slice(5, 7));
  if (month === 12) return `${year + 1}-01-01`;
  return `${year}-${pad2(month + 1)}-01`;
}
