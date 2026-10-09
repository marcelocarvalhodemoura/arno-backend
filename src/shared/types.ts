import type {
  BranchId,
  YouthBranchId,
  MemberRole,
  MemberStatus,
  TxType,
  TxNature,
  PaymentMethod,
  TxPaymentStatus,
  UserRole,
  RecordOrigin,
  ImportSource,
  MovementType,
  Fee,
  MemberGuardian,
  MemberAccount,
  MemberArrears,
  FinancialProject,
  Settings,
  MensalidadeRow,
  FeeSchedulePeriod,
} from '../contract/types';

export * from '../contract/types';

export function isAdminRole(role: UserRole | string | undefined | null): boolean {
  return role === 'admin' || role === 'superadmin';
}
export interface Member {
  id: string;
  name: string;
  email: string;
  phone: string;
  branch: YouthBranchId;
  role: MemberRole;
  monthlyFee: number;
  /** Valor especial (filho de chefe / irmão) ou personalizado; o valor vigente vem da composição. Null = tabela. */
  feeOverride?: number | null;
  /** Filho de chefe — XOR com irmãos; aplica feeOverride especial. */
  chiefChild?: boolean;
  status: MemberStatus;
  joinedAt: string;
  clubeLtc: boolean;
  origin: RecordOrigin;
  createdAt: string;
  createdBy?: string;
  updatedAt?: string;
  updatedBy?: string;
}

export interface MemberSibling {
  id: string;
  memberId: string;
  siblingId: string;
  createdAt: string;
  createdBy?: string;
}

export interface Transaction {
  id: string;
  date: string;
  type: TxType;
  nature: TxNature;
  movementTypeId: string;
  description: string;
  amount: number;
  branch: BranchId;
  method: PaymentMethod;
  paymentStatus: TxPaymentStatus;
  paidAt?: string;
  memberId?: string;
  memberAccountId?: string;
  memberGuardianId?: string;
  projectId?: string;
  notes?: string;
  /** Chave do arquivo da nota no S3. */
  notaKey?: string;
  notaFileName?: string;
  notaContentType?: string;
  externalId?: string;
  /** Mensalidade: se a taxa do clube (e a diluição) entra neste mês. */
  clubFeeIncluded?: boolean;
  /** Rateio: id comum a todas as partes do mesmo crédito. */
  splitGroupId?: string;
  /** Rateio: valor original do lançamento antes de partir. */
  splitTotal?: number;
  /** Rateio: índice 1-based desta parte. */
  splitIndex?: number;
  /** Rateio: quantidade de partes. */
  splitCount?: number;
  /** Acordo de dívida (modo separate). */
  arrearsId?: string;
  /** Competência YYYY-MM da parcela do acordo. */
  arrearsYearMonth?: string;
  /** csv | pdf | sicredi — preenchido nas importações novas. */
  importSource?: ImportSource;
  /**
   * Linha original do extrato que gerou o lançamento. Conciliar, ratear ou editar muda data, histórico
   * e valor; estes campos não mudam e são o que a reimportação compara.
   */
  sourceDate?: string;
  sourceDescription?: string;
  sourceAmount?: number;
  createdBy?: string;
  createdAt: string;
  updatedAt?: string;
  updatedBy?: string;
  origin: RecordOrigin;
}

export interface MensalidadeReport {
  year: number;
  dueDay: number;
  months: number[];
  rows: MensalidadeRow[];
  summary: {
    paid: number;
    pending: number;
    overdue: number;
    openAmount: number;
    paidAmount: number;
  };
}

/** Lançamento excluído: fica 30 dias na lixeira para restaurar. */
export interface TrashedTransaction {
  id: string;
  transaction: Transaction;
  deletedAt: string;
  deletedBy?: string;
}

/** Mês conferido pela tesouraria; guarda os totais do momento do fechamento. */
export interface MonthClosing {
  yearMonth: string;
  closedAt: string;
  closedBy?: string;
  income: number;
  expense: number;
  balance: number;
}

export interface DatabaseShape {
  trash?: TrashedTransaction[];
  monthClosings?: MonthClosing[];
  /** Vazio/ausente = tabela padrão (DEFAULT_FEE_SCHEDULE). */
  feeSchedule?: FeeSchedulePeriod[];
  members: Member[];
  memberGuardians: MemberGuardian[];
  memberSiblings: MemberSibling[];
  memberAccounts: MemberAccount[];
  memberArrears?: MemberArrears[];
  movementTypes: MovementType[];
  fees: Fee[];
  transactions: Transaction[];
  projects: FinancialProject[];
  settings: Settings;
}

export interface CashFlowMonth {
  month: string;
  income: number;
  expense: number;
  net: number;
  balance: number;
  byMovementType: {
    movementTypeId: string;
    name: string;
    income: number;
    expense: number;
  }[];
  byBranch: { branch: BranchId; income: number; expense: number }[];
}

export interface TypePayer {
  memberId: string;
  name: string;
  branch: BranchId;
  amount: number;
  count: number;
  lastDate: string;
}

/** Quem pagou cada tipo de público interno (acampamento, bivaque…) escolhido no filtro. */
export interface TypePayers {
  movementTypeId: string;
  name: string;
  payers: TypePayer[];
  total: number;
  /** Entradas do tipo sem associado vinculado. */
  unlinked: { amount: number; count: number };
}

export function roundMoney(n: number): number {
  return Math.round(n * 100) / 100;
}

export function monthKey(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, '0')}`;
}

export function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

export function lastDayOfMonth(year: number, month: number): string {
  const last = new Date(year, month, 0).getDate();
  return `${year}-${pad2(month)}-${pad2(last)}`;
}

export function periodBounds(year: number, month: number): { from: string; to: string } {
  if (!month) {
    return { from: `${year}-01-01`, to: `${year}-12-31` };
  }
  return { from: `${year}-${pad2(month)}-01`, to: lastDayOfMonth(year, month) };
}
