import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { z } from 'zod';
import { ingestTransactions } from './ingest';
import { interpretUploadedStatement } from './interpret-upload';
import { remapImportCsv, type FieldMapping } from './import-map';
import { aiConfigured } from './statement-ai';
import { fail } from '../shared/http/api';
import { errorMessage } from '../shared/http/errors';
import { txImportRow } from '../shared/http/schemas';
import { mutate } from '../shared/persistence/finance-store';
import { IMPORT_CHUNK_SIZE } from '../shared/types';

const mappingSchema = z.record(z.string(), z.string()).optional();

const interpretBody = z
  .object({
    csv: z.string().min(1).max(7_000_000).optional(),
    pdf: z.string().min(1).max(10_000_000).optional(),
    mapping: mappingSchema,
    lineOffset: z.number().int().min(0).max(50_000).optional(),
    enrichAi: z.boolean().optional(),
    convertOnly: z.boolean().optional(),
  })
  .refine((value) => Boolean(value.csv || value.pdf), 'Envie o CSV ou o PDF do extrato');

const mapImportBody = z.object({
  csv: z.string().min(1).max(7_000_000),
  kind: z.enum(['members', 'statement']),
  mapping: mappingSchema,
});

const ingestBody = z.object({
  rows: z.array(txImportRow).min(1).max(IMPORT_CHUNK_SIZE),
  importSource: z.enum(['csv', 'pdf']).optional(),
});

@Injectable()
export class StatementService {
  async interpret(body: unknown, userId: string) {
    const parsed = interpretBody.safeParse(body);
    if (!parsed.success) fail('Envie o conteúdo do CSV ou do PDF do extrato', HttpStatus.BAD_REQUEST);
    try {
      return await interpretUploadedStatement(
        {
          ...parsed.data,
          mapping: parsed.data.mapping as FieldMapping | undefined,
        },
        userId,
      );
    } catch (error) {
      fail(errorMessage(error, 'Não foi possível ler o extrato'), HttpStatus.BAD_REQUEST);
    }
  }

  async mapImport(body: unknown) {
    const parsed = mapImportBody.safeParse(body);
    if (!parsed.success) fail('Envie o conteúdo da planilha', HttpStatus.BAD_REQUEST);
    const given = parsed.data.mapping as FieldMapping | undefined;
    const remapped = await remapImportCsv(parsed.data.csv, parsed.data.kind, {
      mapping: given && Object.keys(given).length ? given : undefined,
      review: !(given && Object.keys(given).length),
    });
    return {
      csv: remapped.csv,
      usedAi: remapped.usedAi,
      aiAvailable: aiConfigured(),
      mapping: remapped.mapping,
      sample: remapped.sample,
      review: remapped.review,
      headerIndex: remapped.headerIndex,
    };
  }

  async ingest(body: unknown, userId: string) {
    const parsed = ingestBody.safeParse(body);
    if (!parsed.success) {
      throw new HttpException({ error: parsed.error.flatten() }, HttpStatus.BAD_REQUEST);
    }
    try {
      const batchSource = parsed.data.importSource;
      const rows = parsed.data.rows.map((row) => ({
        ...row,
        importSource: row.importSource ?? batchSource,
      }));
      const result = await mutate((db) => ingestTransactions(db, rows, userId, 'integration'));
      return {
        created: result.created.length,
        paid: result.paid.length,
        unidentified: result.unidentified.length,
        skipped: result.skipped,
      };
    } catch (error) {
      fail(errorMessage(error, 'Não foi possível importar o extrato'), HttpStatus.BAD_REQUEST);
    }
  }
}
