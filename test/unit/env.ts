// Testes de unidade não chamam IA de verdade, mesmo com a chave no .env local (ver test/integration/env.ts).
process.env.OPENAI_API_KEY = '';
