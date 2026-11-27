import { z } from 'zod';

export const youthBranch = z.enum(['filhote', 'lobinho', 'escoteiro', 'senior', 'pioneiro', 'flor-de-lis']);
export const branch = z.enum(['filhote', 'lobinho', 'escoteiro', 'senior', 'pioneiro', 'flor-de-lis', 'grupo']);
export const method = z.enum(['pix', 'cash', 'transfer', 'card', 'other']);
/** Meio gravado: inclui a permuta, que só pode ser mantida (nunca escolhida) na edição. */
export const storedMethod = z.enum(['pix', 'cash', 'transfer', 'card', 'other', 'barter']);
export const paymentStatus = z.enum(['paid', 'pending']);
export const nature = z.enum(['fixed', 'variable']);
export const txType = z.enum(['income', 'expense']);
export const holderKind = z.enum(['parent', 'youth', 'other']);
export const direction = z.enum(['income', 'expense', 'both']);
export const audience = z.enum(['internal', 'external', 'general']);
export const userRole = z.enum(['superadmin', 'admin', 'tesoureiro']);

export function optionalContactEmail(value: unknown): string {
  const trimmed = String(value ?? '')
    .trim()
    .replace(/^mailto:/i, '');
  if (!trimmed) return '';
  const candidate =
    trimmed
      .split(/[\s;,/]+/)
      .map((part) => part.replace(/,+/g, '.').replace(/^\.|\.$/g, ''))
      .find((part) => part.includes('@')) ?? '';
  return z.string().email().safeParse(candidate).success ? candidate : '';
}

export const guardianInput = z.object({
  id: z.string().min(1).optional(),
  name: z.string().min(2),
  relationship: z.string().min(2),
  phone: z.string().optional().default(''),
  email: z
    .string()
    .optional()
    .default('')
    .refine((value) => !value || z.string().email().safeParse(value).success, 'E-mail do responsável inválido'),
});

const guardianImportInput = guardianInput.extend({
  email: z.preprocess(optionalContactEmail, z.string()),
});

export const accountBody = z.object({
  holderName: z.string().min(2),
  holderKind,
  relationship: z.string().min(1),
  pixKey: z.string().optional().default(''),
  bank: z.string().optional().default(''),
  agency: z.string().optional().default(''),
  accountNumber: z.string().optional().default(''),
  document: z.string().optional().default(''),
  notes: z.string().optional(),
  isPrimary: z.boolean().optional().default(false),
});

const memberEmail = z.string().trim().email().or(z.literal(''));

export const memberImportRow = z.object({
  name: z.string().min(2),
  email: memberEmail.optional().default(''),
  phone: z.string().min(8),
  branch: youthBranch,
  role: z.enum(['jovem', 'escotista', 'dirigente', 'clube']),
  monthlyFee: z.number().min(0).optional(),
  joinedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  clubeLtc: z.boolean(),
  guardians: z.array(guardianImportInput).optional(),
});

export const importSource = z.enum(['csv', 'pdf', 'sicredi']);

export const txImportRow = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  type: txType,
  nature,
  movementTypeId: z.string().min(1),
  description: z.string().min(2),
  amount: z.number().positive(),
  branch,
  method,
  paymentStatus: paymentStatus.optional(),
  memberId: z.string().optional(),
  memberGuardianId: z.string().optional(),
  importSource: importSource.optional(),
});

export const createMemberBody = z.object({
  name: z.string().min(2),
  email: memberEmail.optional().default(''),
  phone: z.string().min(8),
  branch: youthBranch,
  role: z.enum(['jovem', 'escotista', 'dirigente', 'clube']),
  monthlyFee: z.number().min(0).optional(),
  feeOverride: z.number().min(0).nullable().optional(),
  chiefChild: z.boolean().optional(),
  siblingIds: z.array(z.string().min(1)).optional(),
  joinedAt: z.string(),
  clubeLtc: z.boolean(),
  guardians: z.array(guardianInput).optional(),
});

export const patchMemberBody = z.object({
  name: z.string().min(2).optional(),
  email: memberEmail.optional(),
  phone: z.string().min(8).optional(),
  branch: youthBranch.optional(),
  role: z.enum(['jovem', 'escotista', 'dirigente', 'clube']).optional(),
  monthlyFee: z.number().min(0).optional(),
  feeOverride: z.number().min(0).nullable().optional(),
  chiefChild: z.boolean().optional(),
  siblingIds: z.array(z.string().min(1)).optional(),
  joinedAt: z.string().optional(),
  clubeLtc: z.boolean().optional(),
  guardians: z.array(guardianInput).optional(),
});

const effectiveDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Informe a data efetiva no formato AAAA-MM-DD');

export const memberStatusBody = z
  .object({
    status: z.enum(['active', 'inactive']),
    reason: z.string().trim().min(3, 'Informe a justificativa (mínimo 3 caracteres)'),
    effectiveDate: effectiveDate.optional(),
    kind: z.enum(['formal', 'informal', 'abandono']).optional(),
    confirmedBy: z.string().trim().max(120).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.status === 'inactive' && !value.kind) {
      ctx.addIssue({
        code: 'custom',
        path: ['kind'],
        message: 'Informe o tipo de desligamento (formal, informal ou abandono)',
      });
    }
    if (value.kind === 'informal' && !value.confirmedBy) {
      ctx.addIssue({ code: 'custom', path: ['confirmedBy'], message: 'Informe quem confirmou a saída' });
    }
  });

export const statusEffectiveDateBody = z.object({
  effectiveDate,
  reason: z.string().trim().min(3, 'Informe a justificativa (mínimo 3 caracteres)'),
});

export const createTransactionBody = z.object({
  date: z.string(),
  type: txType,
  nature,
  movementTypeId: z.string().min(1),
  description: z.string().min(2),
  amount: z.number().positive(),
  branch,
  method,
  paymentStatus: paymentStatus.optional(),
  paidAt: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .optional(),
  memberId: z.string().optional(),
  memberAccountId: z.string().optional(),
  memberGuardianId: z.string().optional(),
  projectId: z.string().optional(),
  notes: z.string().optional(),
});

export const patchTransactionBody = z.object({
  date: z.string().optional(),
  type: txType.optional(),
  nature: nature.optional(),
  movementTypeId: z.string().optional(),
  description: z.string().min(2).optional(),
  amount: z.number().positive().optional(),
  branch: branch.optional(),
  method: storedMethod.optional(),
  paymentStatus: paymentStatus.optional(),
  paidAt: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .optional(),
  memberId: z.string().nullable().optional(),
  memberAccountId: z.string().nullable().optional(),
  memberGuardianId: z.string().nullable().optional(),
  projectId: z.string().nullable().optional(),
  notes: z.string().optional(),
  notifyReceipt: z.boolean().optional(),
});

export type GuardianInput = z.infer<typeof guardianInput>;
export type CreateMemberInput = z.infer<typeof createMemberBody>;
export type PatchMemberInput = z.infer<typeof patchMemberBody>;
export type MemberStatusInput = z.infer<typeof memberStatusBody>;
export type StatusEffectiveDateInput = z.infer<typeof statusEffectiveDateBody>;
export type AccountInput = z.infer<typeof accountBody>;
export type CreateTransactionInput = z.infer<typeof createTransactionBody>;
export type PatchTransactionInput = z.infer<typeof patchTransactionBody>;
export type MemberImportRow = z.infer<typeof memberImportRow>;
