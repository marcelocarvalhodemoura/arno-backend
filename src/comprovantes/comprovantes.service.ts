import { HttpStatus, Injectable } from '@nestjs/common';
import { z } from 'zod';
import { fail } from '../shared/http/api';
import { loadDb, mutate } from '../shared/persistence/finance-store';
import { learnPayerAccount } from '../ledger/transactions';
import { confirmReconciliation } from '../mensalidades/reconciliation';
import { listOpenMensalidades, todayISO } from '../mensalidades/mensalidades';
import { isUnidentifiedName } from '../statement/statement';
import { signedNotaUrl } from '../storage/s3';
import { attachToCredit, retryWaitingProofs } from './proof-whatsapp';
import { findProof, listProofs, updateProof, type ProofStatus } from './proof-store';

const STATUSES: ProofStatus[] = ['waiting', 'matched', 'already', 'review', 'rejected', 'discarded'];

/** Créditos sem tipo com o mesmo valor, até 5 dias antes ou depois do comprovante. */
const CANDIDATE_WINDOW_DAYS = 5;

@Injectable()
export class ComprovantesService {
  async list(status?: string) {
    const wanted = (status ?? '')
      .split(',')
      .map((item) => item.trim())
      .filter((item): item is ProofStatus => STATUSES.includes(item as ProofStatus));
    const [items, db] = await Promise.all([listProofs({ status: wanted }), loadDb()]);
    return items.map((item) => {
      const credit = item.creditId ? db.transactions.find((tx) => tx.id === item.creditId) : undefined;
      return {
        ...item,
        members: item.memberIds
          .map((memberId) => db.members.find((member) => member.id === memberId))
          .filter(Boolean)
          .map((member) => ({ id: member!.id, name: member!.name, branch: member!.branch })),
        credit: credit && {
          id: credit.id,
          date: credit.paidAt ?? credit.date,
          amount: credit.amount,
          description: credit.description,
        },
      };
    });
  }

  /** Aviso no menu: quantos comprovantes esperam a tesouraria. */
  async summary() {
    const items = await listProofs({ status: ['review', 'waiting'] });
    return {
      review: items.filter((item) => item.status === 'review').length,
      waiting: items.filter((item) => item.status === 'waiting').length,
    };
  }

  /** Para a tela de revisão: créditos prováveis e mensalidades em aberto dos associados do telefone. */
  async candidates(id: string) {
    const proof = await findProof(id);
    if (!proof) fail('Comprovante não encontrado', HttpStatus.NOT_FOUND);
    const db = await loadDb();
    const target = dayNumber(proof.date || proof.createdAt);
    const credits = db.transactions
      .filter((tx) => {
        const type = db.movementTypes.find((item) => item.id === tx.movementTypeId);
        return (
          tx.type === 'income' &&
          tx.paymentStatus === 'paid' &&
          (!type || isUnidentifiedName(type.name)) &&
          (!proof.amount || Math.abs(tx.amount - proof.amount) < 0.005) &&
          Math.abs(dayNumber(tx.paidAt ?? tx.date) - target) <= CANDIDATE_WINDOW_DAYS
        );
      })
      .map((tx) => ({ id: tx.id, date: tx.paidAt ?? tx.date, amount: tx.amount, description: tx.description }));
    const today = todayISO();
    const open = proof.memberIds.flatMap((memberId) => {
      const member = db.members.find((item) => item.id === memberId);
      if (!member) return [];
      return listOpenMensalidades(db, memberId, today).map((item) => ({ ...item, memberId, memberName: member.name }));
    });
    return { credits, open };
  }

  async fileUrl(id: string) {
    const proof = await findProof(id);
    if (!proof?.fileKey) fail('Comprovante sem arquivo guardado', HttpStatus.NOT_FOUND);
    return {
      url: await signedNotaUrl(proof.fileKey, proof.fileName),
      fileName: proof.fileName ?? 'comprovante',
      contentType: proof.contentType ?? '',
    };
  }

  /**
   * Com `pendingId`: o crédito vira aquela mensalidade (baixa de um mês).
   * Sem `pendingId`: só liga o comprovante a um crédito que a tesouraria já identificou — por exemplo,
   * depois de ratear o Pix em vários meses pelo modal de rateio.
   */
  async confirm(id: string, body: unknown, userId: string) {
    const parsed = z.object({ creditId: z.string().min(1), pendingId: z.string().min(1).optional() }).safeParse(body);
    if (!parsed.success) fail('Informe o crédito do extrato', HttpStatus.BAD_REQUEST);
    const proof = await findProof(id);
    if (!proof) fail('Comprovante não encontrado', HttpStatus.NOT_FOUND);
    if (proof.status === 'matched' || proof.status === 'already')
      fail('Comprovante já conciliado', HttpStatus.CONFLICT);
    const { creditId, pendingId } = parsed.data;
    let memberId = '';
    try {
      await mutate((db) => {
        if (!pendingId) {
          const credit = db.transactions.find((tx) => tx.id === creditId);
          const type = credit && db.movementTypes.find((item) => item.id === credit.movementTypeId);
          if (credit && (!type || isUnidentifiedName(type.name))) {
            throw new Error('O crédito ainda está "A identificar"; escolha a mensalidade');
          }
          memberId = credit?.memberId ?? '';
          return;
        }
        const credit = confirmReconciliation(db, creditId, pendingId, userId);
        memberId = credit.memberId ?? '';
        const pixLine = (credit.notes ?? '')
          .split('\n')
          .reverse()
          .find((line) => line.startsWith('Pix: '));
        learnPayerAccount(db, { ...credit, description: pixLine ? pixLine.slice(5) : credit.description }, userId);
      });
    } catch (err) {
      fail(err instanceof Error ? err.message : 'Não foi possível conciliar', HttpStatus.BAD_REQUEST);
    }
    const updated = await updateProof(id, {
      status: 'matched',
      reason: pendingId ? 'Conferido pela tesouraria' : 'Conferido pela tesouraria (rateio em vários meses)',
      creditId,
      memberIds: memberId ? [memberId] : proof.memberIds,
      resolvedBy: userId,
    });
    await attachToCredit(updated, creditId);
    return updated;
  }

  async discard(id: string, body: unknown, userId: string) {
    const parsed = z.object({ reason: z.string().max(300).optional() }).safeParse(body ?? {});
    const proof = await findProof(id);
    if (!proof) fail('Comprovante não encontrado', HttpStatus.NOT_FOUND);
    return updateProof(id, {
      status: 'discarded',
      reason: (parsed.success && parsed.data.reason) || 'Descartado pela tesouraria',
      resolvedBy: userId,
    });
  }

  retry(userId: string) {
    return retryWaitingProofs(userId);
  }
}

function dayNumber(iso: string) {
  return Math.round(Date.parse(`${iso.slice(0, 10)}T12:00:00Z`) / 86_400_000);
}
