import { chunkList, IMPORT_CHUNK_SIZE } from './types';
import { memberImportRow } from './http/schemas';

describe('chunkList', () => {
  it('splits oversized imports into request-sized batches', () => {
    const items = Array.from({ length: 401 }, (_, index) => index);
    const chunks = chunkList(items);
    expect(chunks).toHaveLength(3);
    expect(chunks[0]).toHaveLength(IMPORT_CHUNK_SIZE);
    expect(chunks[2]).toHaveLength(1);
  });
});

describe('memberImportRow', () => {
  it('clears a responsible e-mail that is not an e-mail', () => {
    const parsed = memberImportRow.safeParse({
      name: 'Ana Souza',
      email: 'ana@arnofriedrich.org.br',
      phone: '(51) 99999-1001',
      branch: 'lobinho',
      role: 'jovem',
      joinedAt: '2023-03-11',
      clubeLtc: false,
      guardians: [
        {
          name: 'Helena Souza',
          relationship: 'Mãe',
          email: 'nao informado no cadastro',
        },
      ],
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.guardians?.[0]?.email).toBe('');
    }
  });
});
