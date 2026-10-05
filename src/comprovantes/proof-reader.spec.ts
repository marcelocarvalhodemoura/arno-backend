import { isComplete, merge, parseProofText } from './proof-reader';

const E2E = 'E00416968202610031722abcDEF12345';

describe('parseProofText', () => {
  it('lê comprovante Pix com seções de pagador e recebedor (layout Sicredi)', () => {
    const text = [
      'Comprovante de Pix',
      'Valor R$ 82,00',
      'Data do pagamento 03/10/2026 14:22',
      'Dados do pagador',
      'MARIA DA SILVA',
      'CPF ***.123.456-**',
      'Instituição BANCO COOPERATIVO SICREDI',
      'Dados do recebedor',
      'Nome: GRUPO ESCOTEIRO ARNO FRIEDRICH',
      'CNPJ 12.345.678/0001-90',
      `ID da transação ${E2E}`,
    ].join('\n');
    const proof = parseProofText(text);
    expect(proof).toMatchObject({
      kind: 'pix',
      amount: 82,
      date: '2026-10-03',
      e2e: E2E,
      payerName: 'MARIA DA SILVA',
      payerDocument: '***.123.456-**',
      payeeName: 'GRUPO ESCOTEIRO ARNO FRIEDRICH',
      payeeDocument: '12.345.678/0001-90',
    });
    expect(isComplete(proof)).toBe(true);
  });

  it('junta o id do Pix quebrado em duas linhas e ignora a tarifa', () => {
    const text = [
      'Pix enviado',
      'Tarifa R$ 0,00',
      'Valor do Pix: R$ 1.234,56',
      '5 de out. de 2026',
      'De',
      'JOÃO PEREIRA',
      'Para',
      'GRUPO ESCOTEIRO ARNO',
      'ID: E00416968202610',
      '031722abcDEF12345',
    ].join('\n');
    const proof = parseProofText(text);
    expect(proof.amount).toBe(1234.56);
    expect(proof.date).toBe('2026-10-05');
    expect(proof.e2e).toBe(E2E);
    expect(proof.payerName).toBe('JOÃO PEREIRA');
    expect(proof.payeeName).toBe('GRUPO ESCOTEIRO ARNO');
  });

  it('não confunde dígitos do id do Pix com CNPJ do recebedor', () => {
    const text = ['Dados do recebedor', 'GRUPO ESCOTEIRO ARNO', `ID da transação ${E2E}`, 'Valor R$ 5,00'].join('\n');
    expect(parseProofText(text).payeeDocument).toBe('');
    expect(parseProofText('Recebedor\nARNO\nCNPJ 12345678000190').payeeDocument).toBe('12345678000190');
  });

  it('sem data legível usa a data do id do Pix (convertida para Brasília)', () => {
    // 02:10 UTC do dia 04 = 23:10 do dia 03 em Brasília.
    const proof = parseProofText('Pix\nValor R$ 10,00\nE00416968202610040210abcDEF12345');
    expect(proof.date).toBe('2026-10-03');
  });

  it('reconhece TED, boleto e nota fiscal', () => {
    expect(parseProofText('Comprovante de TED\nValor R$ 50,00\n01/10/2026').kind).toBe('ted');
    expect(parseProofText('Pagamento de boleto\nCódigo de barras 1234\nValor R$ 50,00').kind).toBe('boleto');
    expect(parseProofText('DANFE NFC-e\nValor total R$ 50,00').kind).toBe('nota_fiscal');
  });

  it('documento que não é comprovante fica incompleto', () => {
    const proof = parseProofText('ESTATUTO DO GRUPO ESCOTEIRO\nCapítulo I — Da denominação');
    expect(proof.kind).toBe('outro');
    expect(proof.amount).toBe(0);
    expect(isComplete(proof)).toBe(false);
  });
});

describe('merge (regras + IA)', () => {
  it('completa o que faltou e valida o id do Pix vindo da IA', () => {
    const base = parseProofText('');
    const merged = merge(
      base,
      { tipo: 'pix', valor: '82,00', data: '2026-10-03', e2e: ` ${E2E} `, pagadorNome: 'MARIA', recebedorNome: 'ARNO' },
      '',
    );
    expect(merged).toMatchObject({ kind: 'pix', source: 'ia', amount: 82, date: '2026-10-03', e2e: E2E });
  });

  it('descarta id inválido e data impossível vindos da IA', () => {
    const merged = merge(parseProofText(''), { tipo: 'pix', valor: 82, data: '2026-02-31', e2e: 'E123' }, '');
    expect(merged.e2e).toBe('');
    expect(merged.date).toBe('');
  });

  it('o id do Pix achado pelas regras prevalece sobre a IA', () => {
    const base = parseProofText(`Pix\n${E2E}`);
    const merged = merge(base, { e2e: 'E99999999202610031722zzzZZZ99999', valor: 5 }, '');
    expect(merged.e2e).toBe(E2E);
  });
});
