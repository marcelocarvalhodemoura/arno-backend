import '../../src/shared/env';
import { TEST_PASSWORD, TEST_TREASURER_USER } from './credentials';

const configured = process.env.DATABASE_URL;
if (!configured) {
  throw new Error(
    'DATABASE_URL não definida. Copie arno-backend/.env.example para .env (ou use application/.env) antes de rodar os testes de integração/E2E.',
  );
}

process.env.DATABASE_ADMIN_URL ??= configured;
process.env.DATABASE_URL = configured.replace(/\/[^/?]+(\?.*)?$/, '/tesouraria_test$1');
process.env.AUTH_SECRET ??= 'test-secret';
process.env.ADMIN_USER = TEST_TREASURER_USER;
process.env.ADMIN_PASSWORD = TEST_PASSWORD;
process.env.MAIL_MOCK = '1';
