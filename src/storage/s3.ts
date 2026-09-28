import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { randomUUID } from 'node:crypto';
import { extname } from 'node:path';

const ALLOWED_CONTENT_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'application/pdf']);

const MAX_BYTES = 10 * 1024 * 1024;

let client: S3Client | null = null;

export function s3Configured() {
  return Boolean(process.env.AWS_S3_BUCKET?.trim());
}

function bucket() {
  const name = process.env.AWS_S3_BUCKET?.trim();
  if (!name) throw new Error('AWS_S3_BUCKET não configurado');
  return name;
}

function region() {
  return process.env.AWS_REGION?.trim() || process.env.AWS_DEFAULT_REGION?.trim() || 'us-east-1';
}

function s3() {
  if (!client) {
    client = new S3Client({ region: region() });
  }
  return client;
}

export function assertNotaFile(file: { mimetype?: string; size?: number; originalname?: string }) {
  const type = file.mimetype?.toLowerCase() ?? '';
  if (!ALLOWED_CONTENT_TYPES.has(type)) {
    throw new Error('Envie a nota em PDF ou imagem (JPEG, PNG, WebP ou GIF)');
  }
  if ((file.size ?? 0) <= 0) throw new Error('Arquivo vazio');
  if ((file.size ?? 0) > MAX_BYTES) throw new Error('A nota pode ter no máximo 10 MB');
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
  const ext = safeExtension(fileName, contentType);
  return `notas/${transactionId}/${randomUUID()}${ext}`;
}

export async function uploadNotaObject(input: { key: string; body: Buffer; contentType: string; fileName: string }) {
  await s3().send(
    new PutObjectCommand({
      Bucket: bucket(),
      Key: input.key,
      Body: input.body,
      ContentType: input.contentType,
      ContentDisposition: `inline; filename="${input.fileName.replace(/"/g, '')}"`,
      ServerSideEncryption: 'AES256',
      Metadata: {
        'original-name': encodeURIComponent(input.fileName).slice(0, 256),
      },
    }),
  );
}

export async function deleteNotaObject(key: string) {
  if (!key) return;
  await s3().send(
    new DeleteObjectCommand({
      Bucket: bucket(),
      Key: key,
    }),
  );
}

export async function signedNotaUrl(key: string, fileName?: string, expiresIn = 60 * 15) {
  const command = new GetObjectCommand({
    Bucket: bucket(),
    Key: key,
    ResponseContentDisposition: fileName ? `inline; filename="${fileName.replace(/"/g, '')}"` : undefined,
  });
  return getSignedUrl(s3(), command, { expiresIn });
}

export const NOTA_ALLOWED_TYPES = [...ALLOWED_CONTENT_TYPES];
export const NOTA_MAX_BYTES = MAX_BYTES;
