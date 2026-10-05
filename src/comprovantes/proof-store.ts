import type { PaymentProof as PaymentProofRow } from '@prisma/client';
import { prisma } from '../shared/db';
import type { ProofData } from './proof-reader';

export type ProofStatus = 'waiting' | 'matched' | 'already' | 'review' | 'rejected' | 'discarded';

export type PaymentProof = {
  id: string;
  phone: string;
  senderName: string;
  memberIds: string[];
  status: ProofStatus;
  reason: string;
  kind: string;
  source: string;
  amount: number;
  date: string;
  e2e: string;
  bank: string;
  payerName: string;
  payerDocument: string;
  payeeName: string;
  payeeDocument: string;
  caption: string;
  fileKey?: string;
  fileName?: string;
  contentType?: string;
  creditId?: string;
  createdAt: string;
  updatedAt?: string;
};

function map(row: PaymentProofRow): PaymentProof {
  return {
    id: row.id,
    phone: row.phone,
    senderName: row.senderName,
    memberIds: row.memberIds,
    status: row.status as ProofStatus,
    reason: row.reason,
    kind: row.kind,
    source: row.source,
    amount: row.amount ? Number(row.amount) : 0,
    date: row.date ? row.date.toISOString().slice(0, 10) : '',
    e2e: row.e2e ?? '',
    bank: row.bank,
    payerName: row.payerName,
    payerDocument: row.payerDocument,
    payeeName: row.payeeName,
    payeeDocument: row.payeeDocument,
    caption: row.caption,
    fileKey: row.fileKey ?? undefined,
    fileName: row.fileName ?? undefined,
    contentType: row.contentType ?? undefined,
    creditId: row.creditId ?? undefined,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt?.toISOString(),
  };
}

/** Rebuild do ProofData a partir do registro, para reconciliar de novo (crédito chegou depois). */
export function proofData(item: PaymentProof): ProofData {
  return {
    kind: item.kind as ProofData['kind'],
    source: item.source as ProofData['source'],
    amount: item.amount,
    date: item.date,
    e2e: item.e2e,
    bank: item.bank,
    payerName: item.payerName,
    payerDocument: item.payerDocument,
    payeeName: item.payeeName,
    payeeDocument: item.payeeDocument,
    rawText: '',
  };
}

export async function createProof(input: {
  messageId: string;
  phone: string;
  senderName: string;
  memberIds: string[];
  status: ProofStatus;
  reason: string;
  proof: ProofData;
  caption: string;
  creditId?: string;
}) {
  const { proof } = input;
  const row = await prisma.paymentProof.create({
    data: {
      messageId: input.messageId,
      phone: input.phone,
      senderName: input.senderName,
      memberIds: input.memberIds,
      status: input.status,
      reason: input.reason,
      kind: proof.kind,
      source: proof.source,
      amount: proof.amount > 0 ? proof.amount : null,
      date: proof.date ? new Date(`${proof.date}T00:00:00.000Z`) : null,
      e2e: proof.e2e || null,
      bank: proof.bank,
      payerName: proof.payerName,
      payerDocument: proof.payerDocument,
      payeeName: proof.payeeName,
      payeeDocument: proof.payeeDocument,
      caption: input.caption,
      rawText: proof.rawText,
      creditId: input.creditId ?? null,
    },
  });
  return map(row);
}

export async function updateProof(
  id: string,
  patch: Partial<
    Pick<PaymentProof, 'status' | 'reason' | 'creditId' | 'fileKey' | 'fileName' | 'contentType' | 'memberIds'>
  > & {
    resolvedBy?: string;
  },
) {
  const row = await prisma.paymentProof.update({
    where: { id },
    data: { ...patch, updatedAt: new Date() },
  });
  return map(row);
}

export async function findProof(id: string) {
  const row = await prisma.paymentProof.findUnique({ where: { id } });
  return row ? map(row) : null;
}

/** Mesmo Pix já tratado (o associado reenviou o comprovante). */
export async function findSettledByE2e(e2e: string) {
  if (!e2e) return null;
  const row = await prisma.paymentProof.findFirst({
    where: { e2e, status: { in: ['matched', 'already', 'waiting', 'review'] } },
    orderBy: { createdAt: 'desc' },
  });
  return row ? map(row) : null;
}

export async function listProofs(filter: { status?: ProofStatus[] } = {}) {
  const rows = await prisma.paymentProof.findMany({
    where: filter.status?.length ? { status: { in: filter.status } } : undefined,
    orderBy: { createdAt: 'desc' },
    take: 300,
  });
  return rows.map(map);
}

/** Último comprovante do telefone ainda aberto, para anexar o texto que o associado responder. */
export async function latestOpenProofOf(phone: string, since: Date) {
  const row = await prisma.paymentProof.findFirst({
    where: { phone, status: { in: ['review', 'waiting'] }, createdAt: { gte: since } },
    orderBy: { createdAt: 'desc' },
  });
  return row ? map(row) : null;
}

export async function appendReason(id: string, text: string) {
  const row = await prisma.paymentProof.findUnique({ where: { id } });
  if (!row) return;
  await prisma.paymentProof.update({
    where: { id },
    data: { reason: [row.reason, `Mensagem: ${text.slice(0, 300)}`].filter(Boolean).join('\n'), updatedAt: new Date() },
  });
}
