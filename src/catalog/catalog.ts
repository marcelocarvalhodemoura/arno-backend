import { createdAudit, updatedAudit } from "../shared/audit";
import { id } from "../shared/id";
import type { DatabaseShape, Fee, MovementType, Settings } from "../shared/types";
import { resolveMensalidadeDueDay, roundMoney } from "../shared/types";
import { refreshPendingMensalidadeSchedule } from "../mensalidades/mensalidades";
import { ensureOfficialMensalidadeFees } from "../mensalidades/fee-table";

export function patchSettings(
  db: DatabaseShape,
  input: { openingBalance?: number; groupName?: string; mensalidadeDueDay?: number },
  userId: string,
): Settings {
  if (input.openingBalance !== undefined) db.settings.openingBalance = input.openingBalance;
  if (input.groupName !== undefined) db.settings.groupName = input.groupName;
  if (input.mensalidadeDueDay !== undefined) {
    db.settings.mensalidadeDueDay = resolveMensalidadeDueDay(input.mensalidadeDueDay);
    refreshPendingMensalidadeSchedule(db, undefined, userId);
  }
  return db.settings;
}

export function createMovementType(
  db: DatabaseShape,
  input: {
    name: string;
    direction: MovementType["direction"];
    description?: string;
    pixKey?: string;
    branch?: MovementType["branch"];
  },
  userId: string,
): MovementType {
  if (db.movementTypes.some((item) => item.name.toLowerCase() === input.name.toLowerCase())) {
    throw new Error("Tipo já cadastrado");
  }
  const type: MovementType = {
    id: id(),
    active: true,
    name: input.name,
    direction: input.direction,
    description: input.description ?? "",
    pixKey: (input.pixKey ?? "").trim(),
    branch: input.branch ?? "grupo",
    ...createdAudit(userId),
  };
  db.movementTypes.push(type);
  return type;
}

export function updateMovementType(
  db: DatabaseShape,
  typeId: string,
  input: {
    name?: string;
    direction?: MovementType["direction"];
    description?: string;
    pixKey?: string;
    branch?: MovementType["branch"];
    active?: boolean;
  },
  userId: string,
): MovementType | null {
  const type = db.movementTypes.find((item) => item.id === typeId);
  if (!type) return null;
  if (input.name) {
    const clash = db.movementTypes.some(
      (other) => other.id !== type.id && other.name.toLowerCase() === input.name!.toLowerCase(),
    );
    if (clash) throw new Error("Tipo já cadastrado");
  }
  Object.assign(type, input, updatedAudit(userId));
  if (input.pixKey !== undefined) type.pixKey = input.pixKey.trim();
  return type;
}

export function createFee(db: DatabaseShape, input: { name: string; amount: number }, userId: string): Fee {
  if (db.fees.some((fee) => fee.name.toLowerCase() === input.name.toLowerCase())) {
    throw new Error("Taxa já cadastrada");
  }
  const fee: Fee = {
    id: id(),
    name: input.name,
    amount: roundMoney(input.amount),
    ...createdAudit(userId),
  };
  db.fees.push(fee);
  return fee;
}

export function updateFee(
  db: DatabaseShape,
  feeId: string,
  input: { name?: string; amount?: number },
  userId: string,
): Fee | null {
  const fee = db.fees.find((item) => item.id === feeId);
  if (!fee) return null;
  if (
    input.name &&
    db.fees.some((item) => item.id !== fee.id && item.name.toLowerCase() === input.name!.toLowerCase())
  ) {
    throw new Error("Taxa já cadastrada");
  }
  if (input.name !== undefined) fee.name = input.name;
  if (input.amount !== undefined) fee.amount = roundMoney(input.amount);
  Object.assign(fee, updatedAudit(userId));
  return fee;
}

export function deleteFee(db: DatabaseShape, feeId: string) {
  const index = db.fees.findIndex((fee) => fee.id === feeId);
  if (index < 0) return false;
  db.fees.splice(index, 1);
  return true;
}

export function ensureFees(db: DatabaseShape, userId: string) {
  ensureOfficialMensalidadeFees(db, userId);
}
