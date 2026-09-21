import type { DatabaseShape, MensalidadeReport } from "../shared/types";
import {
  notifyTransaction,
  summarizeDeliveries,
  type NotifyChannel,
  type NotifyDelivery,
  type NotifyKind,
} from "../notifications/notify";

export function collectMensalidadeNotifyIds(
  report: MensalidadeReport,
  input: {
    month?: number;
    kind: NotifyKind;
    memberIds?: string[];
    transactionIds?: string[];
  },
) {
  const wantedMembers = input.memberIds ? new Set(input.memberIds) : null;
  const wantedTx = input.transactionIds ? new Set(input.transactionIds) : null;
  const txIds = new Set<string>();
  for (const row of report.rows) {
    if (wantedMembers && !wantedMembers.has(row.memberId)) continue;
    for (const cell of row.cells) {
      if (input.month && cell.month !== input.month) continue;
      if (!cell.transactionId) continue;
      if (wantedTx && !wantedTx.has(cell.transactionId)) continue;
      if (input.kind === "charge" && cell.status !== "pending" && cell.status !== "overdue") continue;
      if (input.kind === "receipt" && cell.status !== "paid") continue;
      txIds.add(cell.transactionId);
    }
  }
  return txIds;
}

export async function notifyMensalidadeTransactions(
  db: DatabaseShape,
  txIds: Iterable<string>,
  kind: NotifyKind,
  channels: NotifyChannel[],
  userId: string,
) {
  const deliveries: NotifyDelivery[] = [];
  for (const txId of txIds) {
    const tx = db.transactions.find((item) => item.id === txId);
    if (!tx) continue;
    deliveries.push(...(await notifyTransaction(db, tx, kind, channels, userId)));
  }
  return { ...summarizeDeliveries(deliveries), deliveries };
}
