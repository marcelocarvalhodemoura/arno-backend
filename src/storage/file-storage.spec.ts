import { assertNotaFile, buildNotaKey, buildProofKey } from './file-storage';
import { InMemoryFileStorage } from './in-memory-file-storage';

describe('file-storage', () => {
  it('valida tipo e tamanho da nota', () => {
    expect(() => assertNotaFile({ mimetype: 'text/plain', size: 10 })).toThrow('Envie a nota em PDF ou imagem');
    expect(() => assertNotaFile({ mimetype: 'application/pdf', size: 0 })).toThrow('Arquivo vazio');
    expect(() => assertNotaFile({ mimetype: 'image/png', size: 11 * 1024 * 1024 })).toThrow('no máximo 10 MB');
    expect(() => assertNotaFile({ mimetype: 'image/png', size: 100 })).not.toThrow();
  });

  it('monta chaves por lançamento e por comprovante com extensão segura', () => {
    expect(buildNotaKey('tx-1', 'nota fiscal.PDF', 'application/pdf')).toMatch(/^notas\/tx-1\/[\w-]+\.pdf$/);
    expect(buildProofKey('p-1', 'sem-extensao', 'image/png')).toMatch(/^comprovantes\/p-1\/[\w-]+\.png$/);
  });

  it('guarda e remove em memória', async () => {
    const storage = new InMemoryFileStorage();
    await storage.upload({ key: 'a', body: Buffer.from('x'), contentType: 'image/png', fileName: 'a.png' });
    expect(await storage.signedUrl('a')).toBe('memory://a');
    await storage.remove('a');
    expect(storage.files.size).toBe(0);
  });
});
