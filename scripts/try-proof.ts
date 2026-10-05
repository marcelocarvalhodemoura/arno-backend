// Uso: ts-node --transpile-only scripts/try-proof.ts <arquivo> — lê um comprovante sem passar pelo WhatsApp.
import '../src/shared/env';
import { readFileSync } from 'node:fs';
import { readProof } from '../src/comprovantes/proof-reader';

const file = process.argv[2];
const type = file.toLowerCase().endsWith('.pdf')
  ? 'application/pdf'
  : file.toLowerCase().endsWith('.png')
    ? 'image/png'
    : 'image/jpeg';
readProof(readFileSync(file), type).then((proof) => {
  const { rawText, ...rest } = proof;
  console.log(JSON.stringify(rest, null, 2));
});
