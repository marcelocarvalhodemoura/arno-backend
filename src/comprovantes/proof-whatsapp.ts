import { listUsers } from '../identity/users';
import { todayISO } from '../mensalidades/mensalidades';
import { fold } from '../shared/csv';
import { mutate } from '../shared/persistence/finance-store';
import type { Member } from '../shared/types';
import { buildProofKey, s3Configured, uploadNotaObject } from '../storage/s3';
import { extractPdfText } from '../statement/statement-pdf';
import { decodeQr } from '../notas/nota-reader';
import { sendWhatsAppText, type WhatsAppIncomingMessage } from '../notifications/whatsapp';
import { windowOpen } from '../notifications/whatsapp-window';
import { proofReply, reconcileProof, type ProofOutcome } from './proof-intake';
import { readProof } from './proof-reader';
import {
  appendReason,
  createProof,
  findSettledByE2e,
  latestOpenProofOf,
  listProofs,
  proofData,
  updateProof,
  type PaymentProof,
} from './proof-store';

export const PROOF_HELP =
  'Olá! Para registrar um pagamento, envie aqui o comprovante (PDF do banco ou print da tela). Damos baixa assim que o valor aparecer no extrato.';

/** Comprovante sem crédito no extrato depois disso vai para a tesouraria. */
const WAITING_DAYS = 10;

/** Nota fiscal (DANFE/NFC-e) vai para o fluxo de despesas; o resto é tratado como comprovante. */
export async function looksLikeNota(buffer: Buffer, contentType: string) {
  if (contentType === 'application/pdf') {
    const text = fold(await extractPdfText(new Uint8Array(buffer)).catch(() => ''));
    return /\bdanfe\b|nfc-?e|documento auxiliar da nota|nota fiscal/.test(text);
  }
  const qr = await decodeQr(buffer).catch(() => null);
  return Boolean(qr && /nfce|sefaz|fazenda/i.test(qr));
}

/**
 * Trata o arquivo como comprovante de pagamento. Devolve 'nota' quando a leitura mostra que era
 * uma nota fiscal e o remetente pode lançar despesas — quem chamou segue com o fluxo de notas.
 */
export async function processProof(
  message: WhatsAppIncomingMessage,
  media: { body: Buffer; contentType: string },
  context: { members: Member[]; staff: boolean },
): Promise<'done' | 'nota'> {
  const proof = await readProof(media.body, media.contentType);
  console.log(
    `WhatsApp comprovante (${proof.source}, ${proof.kind}): ${proof.amount} · ${proof.date || '?'} · e2e ${proof.e2e || '-'} · ${proof.payerName || '?'}`,
  );
  if (proof.kind === 'nota_fiscal' && context.staff) return 'nota';

  if (!(proof.amount > 0) && proof.kind === 'outro') {
    await reply(
      message.from,
      'Não reconheci um comprovante de pagamento nesse arquivo. Envie o PDF do comprovante do banco ou um print da tela com valor e data.',
    );
    return 'done';
  }

  const previous = await findSettledByE2e(proof.e2e);
  if (previous) {
    await reply(
      message.from,
      `Esse comprovante já tinha sido recebido em ${new Date(previous.createdAt).toLocaleDateString('pt-BR')}. ${statusLine(previous)}`,
    );
    return 'done';
  }

  const memberIds = context.members.map((member) => member.id);
  const userId = await actorUserId();
  const outcome = await mutate((db) => reconcileProof(db, proof, { memberIds, userId, today: todayISO() }));
  const saved = await createProof({
    messageId: message.id,
    phone: message.from,
    senderName: message.contactName ?? '',
    memberIds: outcome.status === 'matched' ? [outcome.memberId] : memberIds,
    status: outcome.status,
    reason: reasonOf(outcome, context.members.length > 0),
    proof,
    caption: message.caption ?? '',
    creditId: 'creditId' in outcome ? outcome.creditId : undefined,
  });

  await storeFile(saved, media, message.fileName, outcome.status === 'matched' ? outcome.creditId : undefined);
  await reply(message.from, proofReply(outcome, proof));
  return 'done';
}

/** Texto solto de quem tem comprovante aberto vira observação para a tesouraria (ex.: "é do Pedro"). */
export async function processMemberText(message: WhatsAppIncomingMessage) {
  const open = await latestOpenProofOf(message.from, new Date(Date.now() - 24 * 3_600_000));
  if (open && message.text?.trim()) {
    await appendReason(open.id, message.text.trim());
    await reply(message.from, 'Anotado, obrigado! A tesouraria vai considerar isso na conferência.');
    return;
  }
  await reply(message.from, PROOF_HELP);
}

/**
 * Depois de cada sincronização do banco: comprovantes que esperavam o crédito são conciliados de novo.
 * A resposta no WhatsApp só sai se a janela gratuita de 24 h ainda estiver aberta.
 */
export async function retryWaitingProofs(userId?: string) {
  const waiting = await listProofs({ status: ['waiting'] });
  if (!waiting.length) return { checked: 0, settled: 0 };
  const actor = userId || (await actorUserId());
  let settled = 0;
  for (const item of waiting) {
    try {
      const proof = proofData(item);
      const outcome = await mutate((db) =>
        reconcileProof(db, proof, { memberIds: item.memberIds, userId: actor, today: todayISO() }),
      );
      if (outcome.status === 'waiting') {
        const age = Date.now() - new Date(item.createdAt).getTime();
        if (age > WAITING_DAYS * 86_400_000) {
          await updateProof(item.id, {
            status: 'review',
            reason: `Crédito não apareceu no extrato em ${WAITING_DAYS} dias`,
          });
        }
        continue;
      }
      settled += 1;
      const updated = await updateProof(item.id, {
        status: outcome.status,
        reason: reasonOf(outcome, item.memberIds.length > 0),
        creditId: 'creditId' in outcome ? outcome.creditId : undefined,
        ...(outcome.status === 'matched' ? { memberIds: [outcome.memberId] } : {}),
      });
      if (outcome.status === 'matched') await attachToCredit(updated, outcome.creditId);
      if ((outcome.status === 'matched' || outcome.status === 'already') && (await windowOpen(item.phone))) {
        await reply(item.phone, proofReply(outcome, proof));
      }
    } catch (error) {
      console.error(`Comprovante ${item.id}:`, error);
    }
  }
  return { checked: waiting.length, settled };
}

function reasonOf(outcome: ProofOutcome, knownSender: boolean) {
  if (outcome.status === 'matched') return `Baixa automática pelo id do Pix: ${outcome.label}`;
  if (outcome.status === 'already') return `Já registrado: ${outcome.label}`;
  const base = outcome.reason;
  return knownSender || outcome.status !== 'review' ? base : `${base} (telefone não cadastrado)`;
}

function statusLine(item: PaymentProof) {
  if (item.status === 'matched' || item.status === 'already') return 'O pagamento já está registrado. Obrigado!';
  if (item.status === 'waiting') return 'Ainda aguardamos o valor aparecer no extrato do banco.';
  return 'A tesouraria está conferindo.';
}

async function storeFile(
  proof: PaymentProof,
  media: { body: Buffer; contentType: string },
  fileName: string | undefined,
  creditId?: string,
) {
  if (!s3Configured()) {
    console.warn('WhatsApp comprovante: AWS_S3_BUCKET não configurado, arquivo não foi guardado');
    return;
  }
  try {
    const name = fileName || `comprovante-${proof.date || todayISO()}${extensionFor(media.contentType)}`;
    const key = buildProofKey(proof.id, name, media.contentType);
    await uploadNotaObject({ key, body: media.body, contentType: media.contentType, fileName: name });
    const updated = await updateProof(proof.id, { fileKey: key, fileName: name, contentType: media.contentType });
    if (creditId) await attachToCredit(updated, creditId);
  } catch (error) {
    console.error('WhatsApp comprovante: falha ao guardar o arquivo', error);
  }
}

/** O comprovante também aparece no lançamento, como as notas (só se o lançamento ainda não tiver arquivo). */
export async function attachToCredit(proof: PaymentProof, creditId: string) {
  if (!proof.fileKey) return;
  await mutate((db) => {
    const tx = db.transactions.find((item) => item.id === creditId);
    if (!tx || tx.notaKey) return;
    tx.notaKey = proof.fileKey;
    tx.notaFileName = proof.fileName;
    tx.notaContentType = proof.contentType;
  });
}

async function reply(to: string, body: string) {
  const sent = await sendWhatsAppText(to, body);
  if (!sent.ok) console.warn(`WhatsApp resposta para ${to} falhou:`, sent.error);
}

function extensionFor(contentType: string) {
  if (contentType === 'application/pdf') return '.pdf';
  if (contentType === 'image/png') return '.png';
  if (contentType === 'image/webp') return '.webp';
  return '.jpg';
}

async function actorUserId() {
  const users = await listUsers();
  return (
    users.find((user) => user.role === 'tesoureiro' && user.active)?.id ?? users.find((user) => user.active)?.id ?? ''
  );
}
