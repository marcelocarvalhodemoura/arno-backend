import { json } from 'express';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import './shared/env';
import { waitForDb } from './shared/db';
import { migrate } from './shared/database/migrate';
import { seedIfEmpty } from './shared/persistence/finance-store';
import { rehashLegacySeedUsers } from './identity/users';
import { startOutboxWorker } from './notifications/outbox';
import { AllExceptionsFilter } from './shared/filters/all-exceptions.filter';

async function bootstrap() {
  await waitForDb();
  await migrate();
  await seedIfEmpty();
  const upgraded = await rehashLegacySeedUsers();
  if (upgraded > 0) {
    console.log(`Senhas de ${upgraded} usuário(s) inicial(is) regravadas em bcrypt`);
  }

  const app = await NestFactory.create(AppModule);
  app.enableCors({ origin: true, credentials: true });
  app.use(json({ limit: '8mb' }));
  app.useGlobalFilters(new AllExceptionsFilter());

  startOutboxWorker();

  const port = Number(process.env.PORT ?? 4000);
  await app.listen(port);
  console.log(`Tesouraria API em http://127.0.0.1:${port}`);
}

bootstrap().catch((error) => {
  console.error('Falha ao iniciar a API:', error);
  process.exit(1);
});
