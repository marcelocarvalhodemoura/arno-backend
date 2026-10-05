export type BranchId = 'filhote' | 'lobinho' | 'escoteiro' | 'senior' | 'pioneiro' | 'flor-de-lis' | 'grupo';

export type YouthBranchId = Exclude<BranchId, 'grupo'>;

export type MemberRole = 'jovem' | 'escotista' | 'dirigente' | 'clube';
export type MemberStatus = 'active' | 'inactive';
export type TxType = 'income' | 'expense';
export type TxNature = 'fixed' | 'variable';
export type PaymentMethod = 'pix' | 'cash' | 'transfer' | 'card' | 'other';
export type TxPaymentStatus = 'paid' | 'pending';
export type MovementDirection = 'income' | 'expense' | 'both';
export type AccountHolderKind = 'parent' | 'youth' | 'other';
export type GuardianRelationship =
  | 'Mãe'
  | 'Pai'
  | 'Madrasta'
  | 'Padrasto'
  | 'Tia'
  | 'Tio'
  | 'Avó'
  | 'Avô'
  | 'Irmã'
  | 'Irmão'
  | 'Responsável legal'
  | 'Outro';
export type ReportGroupBy = 'none' | 'month' | 'branch' | 'movementType' | 'nature' | 'account' | 'member' | 'method';
/** superadmin: tudo do admin + auditoria e gestão de outros super admins. */
export type UserRole = 'superadmin' | 'admin' | 'tesoureiro';

export function isAdminRole(role: UserRole | string | undefined | null): boolean {
  return role === 'admin' || role === 'superadmin';
}
export type RecordOrigin = 'manual' | 'integration' | 'sicredi';

/** Formato da integração que originou o lançamento (CSV/PDF do extrato ou Pix Sicredi). */
export type ImportSource = 'csv' | 'pdf' | 'sicredi';
export type BankProvider = 'sicredi';
export type BankMovementStatus = 'new' | 'matched' | 'imported';

/** Linhas por requisição de importação. O front fatia arquivos maiores. */
export const IMPORT_CHUNK_SIZE = 200;
/** Teto do arquivo inteiro (associados ou extrato). */
export const IMPORT_MAX_ROWS = 10_000;

export function chunkList<T>(items: T[], size = IMPORT_CHUNK_SIZE): T[][] {
  const chunks: T[][] = [];
  const step = size > 0 ? size : IMPORT_CHUNK_SIZE;
  for (let index = 0; index < items.length; index += step) {
    chunks.push(items.slice(index, index + step));
  }
  return chunks;
}

export interface AuditInfo {
  origin: RecordOrigin;
  createdAt: string;
  createdBy?: string;
  updatedAt?: string;
  updatedBy?: string;
}

export const DASHBOARD_BRANCHES: BranchId[] = [
  'filhote',
  'lobinho',
  'escoteiro',
  'senior',
  'pioneiro',
  'flor-de-lis',
  'grupo',
];

export interface AppUser {
  id: string;
  username: string;
  name: string;
  email: string;
  role: UserRole;
  active: boolean;
  createdAt: string;
  origin: RecordOrigin;
  createdBy?: string;
  updatedAt?: string;
  updatedBy?: string;
}

export interface BranchMeta {
  id: YouthBranchId;
  name: string;
  unit: string;
  color: string;
  tone: string;
}

export const YOUTH_BRANCHES: BranchMeta[] = [
  {
    id: 'filhote',
    name: 'Ramo Filhotes',
    unit: 'Filhotes',
    color: '#ee9b00',
    tone: 'amber',
  },
  {
    id: 'lobinho',
    name: 'Ramo Lobinho',
    unit: 'Alcateia',
    color: '#e8b423',
    tone: 'gold',
  },
  {
    id: 'escoteiro',
    name: 'Ramo Escoteiro',
    unit: 'Tropa Escoteira',
    color: '#2d8a4e',
    tone: 'pine',
  },
  {
    id: 'senior',
    name: 'Ramo Sênior',
    unit: 'Tropa Sênior',
    color: '#8b1a2b',
    tone: 'wine',
  },
  {
    id: 'pioneiro',
    name: 'Ramo Pioneiro',
    unit: 'Clã Pioneiro',
    color: '#c8102e',
    tone: 'clay',
  },
  {
    id: 'flor-de-lis',
    name: 'Clube da Flor de Lis',
    unit: 'Flor de Lis',
    color: '#0c2d6b',
    tone: 'navy',
  },
];

export const BRANCH_LABELS: Record<BranchId, string> = {
  filhote: 'Filhotes',
  lobinho: 'Lobinho',
  escoteiro: 'Escoteiro',
  senior: 'Sênior',
  pioneiro: 'Pioneiro',
  'flor-de-lis': 'Flor de Lis',
  grupo: 'Grupo',
};

export const ALL_BRANCHES: BranchId[] = [
  'filhote',
  'lobinho',
  'escoteiro',
  'senior',
  'pioneiro',
  'flor-de-lis',
  'grupo',
];

export const GUARDIAN_RELATIONSHIPS: GuardianRelationship[] = [
  'Mãe',
  'Pai',
  'Madrasta',
  'Padrasto',
  'Tia',
  'Tio',
  'Avó',
  'Avô',
  'Irmã',
  'Irmão',
  'Responsável legal',
  'Outro',
];

export interface MovementType {
  id: string;
  name: string;
  direction: MovementDirection;
  description: string;
  pixKey: string;
  branch: BranchId;
  active: boolean;
  origin: RecordOrigin;
  createdAt: string;
  createdBy?: string;
  updatedAt?: string;
  updatedBy?: string;
}

export interface Fee {
  id: string;
  name: string;
  amount: number;
  origin: RecordOrigin;
  createdAt: string;
  createdBy?: string;
  updatedAt?: string;
  updatedBy?: string;
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

export interface MemberGuardian {
  id: string;
  memberId: string;
  name: string;
  relationship: string;
  phone: string;
  email: string;
  origin: RecordOrigin;
  createdAt: string;
  createdBy?: string;
  updatedAt?: string;
  updatedBy?: string;
}

export interface MemberAccount {
  id: string;
  memberId: string;
  holderName: string;
  holderKind: AccountHolderKind;
  relationship: string;
  pixKey: string;
  bank: string;
  agency: string;
  accountNumber: string;
  document: string;
  notes?: string;
  isPrimary: boolean;
  active: boolean;
  origin: RecordOrigin;
  createdAt: string;
  createdBy?: string;
  updatedAt?: string;
  updatedBy?: string;
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
  createdBy?: string;
  createdAt: string;
  updatedAt?: string;
  updatedBy?: string;
  origin: RecordOrigin;
}

export type ArrearsChargeMode = 'embed' | 'separate';
export type ArrearsStatus = 'active' | 'settled' | 'cancelled';
export type ArrearsPaymentSource = 'manual' | 'mensalidade' | 'separate';

/** Registro de pagamento aplicado ao saldo do acordo. */
export interface ArrearsPayment {
  id: string;
  amount: number;
  paidAt: string;
  method: PaymentMethod;
  source: ArrearsPaymentSource;
  transactionId?: string;
  yearMonth?: string;
  note?: string;
  createdAt: string;
  createdBy?: string;
}

export interface MemberArrears {
  id: string;
  memberId: string;
  originalAmount: number;
  balance: number;
  installmentAmount: number;
  totalCount: number;
  remainingCount: number;
  startYearMonth: string;
  chargeMode: ArrearsChargeMode;
  note: string;
  status: ArrearsStatus;
  /** Histórico de baixas (manual, mensalidade embutida ou lançamento à parte). */
  payments?: ArrearsPayment[];
  origin: RecordOrigin;
  createdAt: string;
  createdBy?: string;
  updatedAt?: string;
  updatedBy?: string;
}

export interface BankMovement {
  id: string;
  provider: BankProvider;
  externalId: string;
  occurredAt: string;
  date: string;
  amount: number;
  type: TxType;
  method: PaymentMethod;
  description: string;
  payerName: string;
  payerDocument: string;
  txid: string;
  status: BankMovementStatus;
  transactionId?: string;
  createdAt: string;
  updatedAt?: string;
}

export interface ProjectItem {
  id: string;
  category: string;
  description: string;
  planned: number;
  movementTypeId?: string;
}

export interface FinancialProject {
  id: string;
  branch: BranchId;
  year: number;
  name: string;
  description: string;
  items: ProjectItem[];
  origin: RecordOrigin;
  createdAt: string;
  createdBy?: string;
  updatedAt?: string;
  updatedBy?: string;
}

export interface Settings {
  openingBalance: number;
  groupName: string;
  mensalidadeDueDay?: number;
}

export type MensalidadeCellStatus = 'paid' | 'pending' | 'overdue' | 'none';

/**
 * Fórmula da mensalidade do mês, parcela por parcela (o que aparece para quem confere).
 * `group` é só o operacional; diluição e acréscimo por atraso vêm separados.
 * `source`: tabela do período, valor especial de família ou valor personalizado do cadastro.
 */
export interface MensalidadeFormula {
  source: 'table' | 'family' | 'custom';
  group: number;
  branch: number;
  snack: number;
  club: number;
  dilution: number;
  lateFee: number;
  total: number;
  /** Divisão ainda não confirmada pela tesouraria (o total vale; as partes, não). */
  pendingSplit: boolean;
}

export interface MensalidadeCell {
  month: number;
  dueDate: string | null;
  status: MensalidadeCellStatus;
  transactionId?: string;
  amount: number;
  /** Valor se pago até o dia de vencimento. */
  onTimeAmount: number;
  /** Valor se pago após o dia de vencimento. */
  lateAmount: number;
  /** Se a parcela do clube está incluída neste mês. */
  clubFeeIncluded: boolean;
  /** Parcela de dívida embutida (modo embed), se houver. */
  arrearsInstallment?: number;
  arrearsPlanId?: string;
  /** Fórmula do mês no prazo e com atraso (ausente em meses sem cobrança). */
  formula?: { onTime: MensalidadeFormula; late: MensalidadeFormula };
  /** Parcela de dívida paga junto com a mensalidade (meses pagos). */
  paidArrearsInstallment?: number;
}

export interface MensalidadeRow {
  memberId: string;
  name: string;
  branch: YouthBranchId;
  role: MemberRole;
  memberStatus: MemberStatus;
  joinedAt: string;
  dueDay: number;
  monthlyFee: number;
  lateFee: number;
  clubeLtc: boolean;
  feeOverride?: number | null;
  chiefChild?: boolean;
  /** Irmãos no grupo (para baixar mensalidades juntas). */
  siblingIds?: string[];
  cells: MensalidadeCell[];
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

/** Perfis com composição própria na tabela da mensalidade. */
export type FeeProfileKey = 'regular' | 'pioneer' | 'familyNonMember' | 'familyMember';

/**
 * Partes da mensalidade (R$).
 * Base = grupo + ramo + lanche. Clube e diluição só entram quando a taxa do clube está incluída (não sócio).
 * Valor especial de família é fixo: grupo + ramo + lanche + clube no prazo + diluição, sem atraso.
 */
export interface FeeComposition {
  /** Operacional — caixa do grupo. */
  group: number;
  /** Caixinha do ramo. */
  branch: number;
  /** Lanche. */
  snack: number;
  /** Taxa do clube (Lindóia) até o vencimento. */
  clubOnTime: number;
  /** Taxa do clube (Lindóia) após o vencimento. */
  clubLate: number;
  /** Diluição dez/jan/fev — vai para o caixa do grupo. */
  dilution: number;
  /** Acréscimo por atraso sobre a base — vai para o caixa do grupo. */
  lateFee: number;
  /** Divisão ainda não confirmada pela tesouraria (o total vale; as partes, não). */
  pendingSplit?: boolean;
}

/** Composição da mensalidade num período de vigência (meses YYYY-MM, fim opcional). */
export interface FeeSchedulePeriod {
  id: string;
  startMonth: string;
  endMonth?: string | null;
  note: string;
  regular: FeeComposition;
  pioneer: FeeComposition;
  /** Null = sem valor especial no período: irmãos e filhos de chefe pagam a tabela normal. */
  familyNonMember: FeeComposition | null;
  familyMember: FeeComposition | null;
  origin: RecordOrigin;
  createdAt: string;
  createdBy?: string;
  updatedAt?: string;
  updatedBy?: string;
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

export interface CustomReportQuery {
  from: string;
  to: string;
  branches: BranchId[];
  types: TxType[];
  natures: TxNature[];
  movementTypeIds: string[];
  groupBy: ReportGroupBy;
}

export interface CustomReportRow {
  key: string;
  label: string;
  income: number;
  expense: number;
  net: number;
  count: number;
}

export interface FiscalLedgerLine {
  seq: number;
  id: string;
  date: string;
  type: TxType;
  nature: TxNature;
  movementType: string;
  branch: BranchId;
  memberName?: string;
  guardianName?: string;
  accountHolder?: string;
  description: string;
  income: number;
  expense: number;
  balance: number;
  createdByName: string;
  createdAt: string;
  updatedByName?: string;
  updatedAt?: string;
  origin: RecordOrigin;
  importSource?: ImportSource;
}

export type BudgetStatus = 'ok' | 'watch' | 'over';

export interface BudgetSlice {
  planned: number;
  actual: number;
  remaining: number;
  status: BudgetStatus;
}

export interface DashboardBudget {
  plannedExpense: number;
  actualExpense: number;
  remaining: number;
  pctUsed: number;
  byBranch: (BudgetSlice & { branch: BranchId })[];
  byMovementType: (BudgetSlice & { movementTypeId: string; name: string })[];
}

export interface DashboardPayload {
  year: number;
  month: number;
  from: string;
  to: string;
  opening: number;
  income: number;
  expense: number;
  current: number;
  members: number;
  activeMembers: number;
  byBranch: {
    branch: BranchId;
    income: number;
    expense: number;
    members: number;
  }[];
  chart: { month: string; income: number; expense: number; balance: number }[];
  /** Previsão anual do grupo (independente do filtro de mês do painel). */
  budget: DashboardBudget;
}

export const DEFAULT_MENSALIDADE_DUE_DAY = 10;

export function resolveMensalidadeDueDay(value?: number | null): number {
  const day = Number(value);
  if (!Number.isInteger(day) || day < 1 || day > 31) return DEFAULT_MENSALIDADE_DUE_DAY;
  return day;
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
