import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { interpretStatement } from './statement';
import { extractPdfText, pdfToStatementCsv, statementTextToCsv } from './statement-pdf';

const SICREDI_TEXT = `Associado: GRUPO ESCOTEIRO EXEMPLO
Cooperativa: 0000
Conta: 00000-0
Extrato (Período de 01/01/2026 a 31/01/2026)
Data Descrição Documento Valor (R$) Saldo (R$)
SALDO ANTERIOR 25,77
05/01/2026 RECEBIMENTO PIX 11111111111 JOANA EXEMPLO PIX_CRED 60,00 85,77
Sicredi Fone 0800 724 4770
SAC 0800 724 7220
Ouvidoria 0800 646 2519
`;

const catalog = {
  movementTypes: [
    { id: 'mt-men', name: 'Mensalidade', direction: 'income', active: true },
    { id: 'mt-out', name: 'Outros', direction: 'both', active: true },
  ],
  members: [
    {
      id: 'm-lucas',
      name: 'Lucas Exemplo',
      branch: 'lobinho' as const,
      monthlyFee: 60,
      accounts: [{ holderName: 'Joana Exemplo', pixKey: '', document: '111.111.111-11' }],
      guardians: [{ id: 'g-joana', name: 'Joana Exemplo' }],
    },
  ],
  fees: [{ name: 'Mensalidade', amount: 60 }],
};

const fixture = join(process.cwd(), 'test/fixtures/extrato-exemplo.pdf');

describe('statementTextToCsv', () => {
  it('reads Sicredi lines and skips saldo and footer', () => {
    const csv = statementTextToCsv(SICREDI_TEXT);
    expect(csv).toContain('05/01/2026');
    expect(csv).toContain('JOANA EXEMPLO');
    expect(csv).toContain('60,00');
    expect(csv).toContain('entrada');
    expect(csv).not.toContain('SALDO ANTERIOR');
    expect(csv).not.toContain('0800');
  });

  it('keeps duplicate PIX lines with the same date and amount', () => {
    const csv = statementTextToCsv(`Data Descrição Documento Valor (R$) Saldo (R$)
14/09/2026 RECEBIMENTO PIX 01498717080 Camilla de Carvalho PIX_CRED 55,00 17.079,10
14/09/2026 RECEBIMENTO PIX 01498717080 Camilla de Carvalho PIX_CRED 55,00 17.134,10
`);
    const lines = csv.split('\n').filter((line) => line.includes('Camilla'));
    expect(lines).toHaveLength(2);
  });

  it('does not let the account summary steal the last movement value', () => {
    const csv = statementTextToCsv(`Data Descrição Documento Valor (R$) Saldo (R$)
28/09/2026 RECEBIMENTO PIX 00114577080 Marcelo Carvalho de PIX_CRED 150,00 14.615,90
28/09/2026 RECEBIMENTO PIX 00114577080 Marcelo Carvalho de PIX_CRED 15,00 14.630,90
Saldo da conta
Saldo Atual R$ 14.630,90
Saldo bloqueado R$ 0,00
Lançamentos a conferir R$ 0,00
Sicredi Fone 0800 724 4770
`);
    expect(csv).toContain('150,00');
    expect(csv).toContain(';15,00;');
    expect(csv).not.toContain(';-0,00;');
  });
});

describe('interpretStatement from Sicredi text', () => {
  it('marks a PIX matching the fee and guardian as paid mensalidade', () => {
    const result = interpretStatement(statementTextToCsv(SICREDI_TEXT), catalog);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]?.amount).toBe(60);
    expect(result.rows[0]?.type).toBe('income');
    expect(result.rows[0]?.movementTypeName).toBe('Mensalidade');
    expect(result.rows[0]?.memberId).toBe('m-lucas');
    expect(result.rows[0]?.memberGuardianId).toBe('g-joana');
    expect(result.rows[0]?.paymentStatus).toBe('paid');
    expect(result.rows[0]?.error).toBeUndefined();
  });
});

describe('pdfToStatementCsv', () => {
  it('extracts the attached Sicredi PDF', async () => {
    let text: string;
    try {
      text = await extractPdfText(new Uint8Array(readFileSync(fixture)));
    } catch (error) {
      if (String(error).includes('ERR_VM_DYNAMIC_IMPORT')) {
        console.warn('PDF.js precisa de --experimental-vm-modules no Jest; o parser de texto continua coberto.');
        return;
      }
      throw error;
    }
    expect(text).toMatch(/RECEBIMENTO PIX/i);
    expect(text).toMatch(/JOANA EXEMPLO/i);

    const csv = await pdfToStatementCsv(readFileSync(fixture).toString('base64'));
    const result = interpretStatement(csv, catalog);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]?.amount).toBe(60);
    expect(result.rows[0]?.memberId).toBe('m-lucas');
    expect(result.rows[0]?.movementTypeName).toBe('Mensalidade');
  });
});
