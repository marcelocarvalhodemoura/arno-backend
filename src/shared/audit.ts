import type { RecordOrigin } from "./types";

export function createdAudit(userId: string, origin: RecordOrigin = "manual") {
  return {
    origin,
    createdBy: userId,
    createdAt: new Date().toISOString(),
  };
}

export function updatedAudit(userId: string) {
  return {
    updatedBy: userId,
    updatedAt: new Date().toISOString(),
  };
}
