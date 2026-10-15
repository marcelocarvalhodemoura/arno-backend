import type { RecordOrigin } from '../types';

/** Conversões entre as colunas do Postgres e os tipos do domínio (datas como texto ISO, origem do registro). */

export function storedOrigin(origin: string | undefined, allowSicredi = false): string {
  if (origin === 'manual') return 'manual';
  if (allowSicredi && origin === 'sicredi') return 'sicredi';
  return 'integration';
}

export function asDate(value: string): Date {
  return new Date(`${value.slice(0, 10)}T00:00:00.000Z`);
}

export function dateOnly(value: Date): string {
  return value.toISOString().slice(0, 10);
}

export function asTimestamp(value: string | null | undefined): Date | null {
  if (!value) return null;
  return new Date(value);
}

export function mapAudit(row: {
  origin: string;
  createdAt: Date;
  createdById: string | null;
  updatedAt: Date | null;
  updatedById: string | null;
}) {
  return {
    origin: (row.origin === 'manual' ? 'manual' : row.origin === 'sicredi' ? 'sicredi' : 'integration') as RecordOrigin,
    createdAt: row.createdAt.toISOString(),
    createdBy: row.createdById ?? undefined,
    updatedAt: row.updatedAt?.toISOString(),
    updatedBy: row.updatedById ?? undefined,
  };
}
