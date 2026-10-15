import { randomUUID } from 'node:crypto';
import { extname } from 'node:path';
import { BusinessRuleViolation } from '../shared/domain/errors';

/** Onde ficam notas fiscais e comprovantes. O domínio só conhece esta interface; o S3 é um detalhe. */
export interface FileStorage {
  isConfigured(): boolean;
  upload(input: { key: string; body: Buffer; contentType: string; fileName: string }): Promise<void>;
  remove(key: string): Promise<void>;
  /** Link temporário para abrir o arquivo no navegador. */
  signedUrl(key: string, fileName?: string, expiresInSeconds?: number): Promise<string>;
}

export const FILE_STORAGE = Symbol('FileStorage');

export const SIGNED_URL_TTL_SECONDS = 15 * 60;

const ALLOWED_CONTENT_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'application/pdf']);
const MAX_BYTES = 10 * 1024 * 1024;

export const NOTA_ALLOWED_TYPES = [...ALLOWED_CONTENT_TYPES];
export const NOTA_MAX_BYTES = MAX_BYTES;

export function assertNotaFile(file: { mimetype?: string; size?: number; originalname?: string }) {
  const type = file.mimetype?.toLowerCase() ?? '';
  if (!ALLOWED_CONTENT_TYPES.has(type)) {
    throw new BusinessRuleViolation('Envie a nota em PDF ou imagem (JPEG, PNG, WebP ou GIF)');
  }
  if ((file.size ?? 0) <= 0) throw new BusinessRuleViolation('Arquivo vazio');
  if ((file.size ?? 0) > MAX_BYTES) throw new BusinessRuleViolation('A nota pode ter no máximo 10 MB');
}

function safeExtension(fileName: string, contentType: string) {
  const fromName = extname(fileName)
    .toLowerCase()
    .replace(/[^.a-z0-9]/g, '');
  if (fromName && fromName.length <= 8) return fromName;
  if (contentType === 'application/pdf') return '.pdf';
  if (contentType === 'image/png') return '.png';
  if (contentType === 'image/webp') return '.webp';
  if (contentType === 'image/gif') return '.gif';
  return '.jpg';
}

export function buildNotaKey(transactionId: string, fileName: string, contentType: string) {
  return `notas/${transactionId}/${randomUUID()}${safeExtension(fileName, contentType)}`;
}

export function buildProofKey(proofId: string, fileName: string, contentType: string) {
  return `comprovantes/${proofId}/${randomUUID()}${safeExtension(fileName, contentType)}`;
}
