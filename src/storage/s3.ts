import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { appConfig } from '../shared/config';
import { SIGNED_URL_TTL_SECONDS, type FileStorage } from './file-storage';

/** Arquivos no bucket AWS_S3_BUCKET, criptografados em repouso. */
export class S3FileStorage implements FileStorage {
  private client: S3Client | null = null;

  isConfigured() {
    return Boolean(appConfig.s3.bucket);
  }

  async upload(input: { key: string; body: Buffer; contentType: string; fileName: string }) {
    await this.s3().send(
      new PutObjectCommand({
        Bucket: this.bucket(),
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

  async remove(key: string) {
    if (!key) return;
    await this.s3().send(new DeleteObjectCommand({ Bucket: this.bucket(), Key: key }));
  }

  signedUrl(key: string, fileName?: string, expiresInSeconds = SIGNED_URL_TTL_SECONDS) {
    const command = new GetObjectCommand({
      Bucket: this.bucket(),
      Key: key,
      ResponseContentDisposition: fileName ? `inline; filename="${fileName.replace(/"/g, '')}"` : undefined,
    });
    return getSignedUrl(this.s3(), command, { expiresIn: expiresInSeconds });
  }

  private bucket() {
    const name = appConfig.s3.bucket;
    if (!name) throw new Error('AWS_S3_BUCKET não configurado');
    return name;
  }

  private s3() {
    this.client ??= new S3Client({ region: appConfig.s3.region });
    return this.client;
  }
}

/** Instância usada pelo código que ainda não recebe dependências por injeção (webhooks do WhatsApp). */
export const s3FileStorage = new S3FileStorage();
