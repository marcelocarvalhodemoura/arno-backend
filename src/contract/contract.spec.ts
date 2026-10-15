import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * O contrato é copiado para o frontend: não pode depender de nada fora desta pasta (Nest, Prisma, Node),
 * senão a cópia não compila do outro lado.
 */
describe('contrato compartilhado', () => {
  const dir = __dirname;
  const files = readdirSync(dir).filter((file) => file.endsWith('.ts') && !file.endsWith('.spec.ts'));

  it.each(files)('%s só importa arquivos do próprio contrato', (file) => {
    const source = readFileSync(join(dir, file), 'utf8');
    const imports = [...source.matchAll(/from '([^']+)'/g)].map((match) => match[1]);
    expect(imports.filter((path) => !path.startsWith('./') || path.includes('/', 2))).toEqual([]);
  });

  it.each(files)('%s não usa APIs exclusivas do Node', (file) => {
    const source = readFileSync(join(dir, file), 'utf8');
    expect(source).not.toMatch(/\b(process|Buffer|require)\b|node:/);
  });
});
