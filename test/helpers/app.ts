import { json } from 'express';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AppModule } from '../../src/app.module';
import { AllExceptionsFilter } from '../../src/shared/filters/all-exceptions.filter';

export async function createTestApp(): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();
  const app = moduleRef.createNestApplication();
  app.enableCors({ origin: true, credentials: true });
  app.use(json({ limit: '8mb' }));
  app.useGlobalFilters(new AllExceptionsFilter());
  await app.init();
  return app;
}
