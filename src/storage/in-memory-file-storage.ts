import type { FileStorage } from './file-storage';

/** Armazenamento em memória para testes. */
export class InMemoryFileStorage implements FileStorage {
  readonly files = new Map<string, { body: Buffer; contentType: string; fileName: string }>();

  constructor(private readonly configured = true) {}

  isConfigured() {
    return this.configured;
  }

  upload(input: { key: string; body: Buffer; contentType: string; fileName: string }) {
    this.files.set(input.key, { body: input.body, contentType: input.contentType, fileName: input.fileName });
    return Promise.resolve();
  }

  remove(key: string) {
    this.files.delete(key);
    return Promise.resolve();
  }

  signedUrl(key: string) {
    return Promise.resolve(`memory://${key}`);
  }
}
