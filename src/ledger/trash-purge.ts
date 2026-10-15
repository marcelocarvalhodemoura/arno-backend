import { unitOfWork } from '../shared/persistence/unit-of-work';
import { appConfig } from '../shared/config';
import { TRASH_DAYS } from './governance';
import { PrismaTransactionRepository } from './infra/prisma-transaction.repository';

const EVERY_MS = 6 * 60 * 60 * 1000;
let timer: ReturnType<typeof setInterval> | null = null;

/** Tira da lixeira o que passou de 30 dias. Antes isso só acontecia de carona em alguma gravação. */
export async function purgeExpiredTrash(now = new Date()) {
  return new PrismaTransactionRepository(unitOfWork).purgeTrash(now, TRASH_DAYS);
}

export function startTrashPurgeWorker() {
  if (timer || appConfig.isUnitTest) return;
  const run = () =>
    void purgeExpiredTrash()
      .then((count) => {
        if (count) console.log(`Lixeira: ${count} lançamento(s) com mais de ${TRASH_DAYS} dias removido(s)`);
      })
      .catch((error) => console.error('Lixeira:', error));
  timer = setInterval(run, EVERY_MS);
  timer.unref();
  run();
}
