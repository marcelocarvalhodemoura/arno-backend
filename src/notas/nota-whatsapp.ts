import { listUsers } from '../identity/users';
import { todayISO } from '../mensalidades/mensalidades';
import { loadDb, mutate } from '../shared/persistence/finance-store';
import { buildNotaKey, NOTA_ALLOWED_TYPES, NOTA_MAX_BYTES, s3Configured, uploadNotaObject } from '../storage/s3';
import { digitsPhone, sendWhatsAppText, whatsappConfig, type WhatsAppIncomingMessage } from '../notifications/whatsapp';
import { notaReply, reconcileNota } from './nota-intake';
import { readNota } from './nota-reader';
import { membersByPhone } from '../comprovantes/proof-intake';
import { looksLikeNota, processMemberText, processProof } from '../comprovantes/proof-whatsapp';

const HELP =
  'Olá! Envie a foto ou o PDF da nota fiscal (de preferência com o QR code visível). Na legenda você pode indicar o ramo, por exemplo "lobinho". Comprovantes de pagamento de associados também podem ser enviados aqui.';

/** Ids de mensagens já tratadas — a Meta reentrega o mesmo evento se o 200 demorar. */
const seen = new Map<string, number>();

export function allowedSender(from: string) {
  const list = (process.env.WHATSAPP_ALLOWED_SENDERS ?? '')
    .split(',')
    .map((item) => digitsPhone(item))
    .filter(Boolean);
  if (!list.length) return process.env.NODE_ENV !== 'production';
  const phone = digitsPhone(from);
  // Celulares do Brasil podem chegar com ou sem o nono dígito.
  return list.some((item) => item === phone || withoutNinthDigit(item) === withoutNinthDigit(phone));
}

function withoutNinthDigit(phone: string) {
  return phone.length === 13 && phone.startsWith('55') ? `${phone.slice(0, 4)}${phone.slice(5)}` : phone;
}

export async function processIncomingMessage(message: WhatsAppIncomingMessage) {
  if (seen.has(message.id)) return;
  seen.set(message.id, Date.now());
  for (const [key, at] of seen) if (Date.now() - at > 86_400_000) seen.delete(key);

  // Tesouraria e chefias (WHATSAPP_ALLOWED_SENDERS) lançam notas de despesa; associados e
  // responsáveis (telefone no cadastro) mandam comprovantes. Desconhecido com arquivo: comprovante
  // guardado para a tesouraria conferir, sem baixa automática.
  const staff = allowedSender(message.from);
  const members = membersByPhone(await loadDb(), message.from);

  if (!message.mediaId) {
    if (members.length) await processMemberText(message);
    else if (staff) await reply(message.from, HELP);
    else console.warn(`WhatsApp: remetente ${message.from} sem cadastro (texto ignorado)`);
    return;
  }

  try {
    const media = await downloadMedia(message.mediaId);
    const contentType = normalizeType(media.contentType, message.fileName);
    if (!NOTA_ALLOWED_TYPES.includes(contentType)) {
      await reply(message.from, 'Não consegui abrir esse arquivo. Envie como foto (JPEG ou PNG) ou PDF.');
      return;
    }
    if (media.body.length > NOTA_MAX_BYTES) {
      await reply(message.from, 'O arquivo passou de 10 MB. Tente uma foto mais leve ou o PDF.');
      return;
    }

    const isNota = staff && (await looksLikeNota(media.body, contentType));
    if (!isNota) {
      const handled = await processProof(message, { body: media.body, contentType }, { members, staff });
      if (handled === 'done') return;
    }

    const nota = await readNota(media.body, contentType);
    console.log(
      `WhatsApp nota (${nota.source}, ${nota.confidence}): ${nota.issuerName || '?'} · ${nota.date || '?'} · ${nota.total} · ${nota.items.length} itens`,
    );
    if (!(nota.total > 0)) {
      await reply(
        message.from,
        'Recebi o arquivo, mas não consegui ler o valor total da nota. Tente uma foto mais nítida, com o QR code inteiro, ou envie o PDF.',
      );
      return;
    }

    const userId = await actorUserId();
    const result = await mutate((db) =>
      reconcileNota(db, nota, { caption: message.caption, userId, today: todayISO() }),
    );

    if (result.needsUpload) {
      if (s3Configured()) {
        const fileName = message.fileName || `nota-${nota.date || todayISO()}${extensionFor(contentType)}`;
        const key = buildNotaKey(result.tx.id, fileName, contentType);
        await uploadNotaObject({ key, body: media.body, contentType, fileName });
        await mutate((db) => {
          const tx = db.transactions.find((item) => item.id === result.tx.id);
          if (!tx) return;
          tx.notaKey = key;
          tx.notaFileName = fileName;
          tx.notaContentType = contentType;
        });
      } else {
        console.warn('WhatsApp nota: AWS_S3_BUCKET não configurado, arquivo não foi anexado');
      }
    }

    await reply(message.from, notaReply(result, nota));
  } catch (error) {
    console.error('WhatsApp nota:', error);
    await reply(
      message.from,
      'Tive um problema ao processar o arquivo. A tesouraria foi avisada pelo log; tente de novo em instantes.',
    );
  }
}

async function reply(to: string, body: string) {
  const sent = await sendWhatsAppText(to, body);
  if (!sent.ok) console.warn(`WhatsApp resposta para ${to} falhou:`, sent.error);
}

export async function downloadMedia(mediaId: string) {
  const { token } = whatsappConfig();
  if (!token) throw new Error('WHATSAPP_TOKEN não configurado');
  const headers = { Authorization: `Bearer ${token}` };
  const meta = await fetch(`https://graph.facebook.com/v21.0/${encodeURIComponent(mediaId)}`, { headers });
  if (!meta.ok) throw new Error(`Mídia ${mediaId}: HTTP ${meta.status} ${(await meta.text()).slice(0, 200)}`);
  const info = (await meta.json()) as { url?: string; mime_type?: string };
  if (!info.url) throw new Error(`Mídia ${mediaId} sem URL`);
  const file = await fetch(info.url, { headers });
  if (!file.ok) throw new Error(`Download da mídia: HTTP ${file.status}`);
  return {
    body: Buffer.from(await file.arrayBuffer()),
    contentType: (info.mime_type ?? file.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase(),
  };
}

const TYPE_BY_EXTENSION: Record<string, string> = {
  pdf: 'application/pdf',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
};

/** Arquivo mandado como "documento" pode chegar sem tipo; vale a extensão do nome. */
export function normalizeType(contentType: string, fileName?: string) {
  if (contentType === 'image/jpg') return 'image/jpeg';
  if (!contentType || contentType === 'application/octet-stream') {
    const extension = fileName?.toLowerCase().split('.').pop() ?? '';
    return TYPE_BY_EXTENSION[extension] ?? contentType;
  }
  return contentType;
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
