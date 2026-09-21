import { detectHeaderIndex, heuristicMapping, remapImportCsv } from './import-map';
import { interpretStatement } from './statement';

const catalog = {
  movementTypes: [
    { id: 'mt-men', name: 'Mensalidade', direction: 'income', active: true },
    { id: 'mt-doa', name: 'Doação', direction: 'income', active: true },
    { id: 'mt-out', name: 'Outros', direction: 'both', active: true },
  ],
  members: [
    {
      id: 'm-ana',
      name: 'Ana Souza',
      branch: 'lobinho' as const,
      monthlyFee: 55,
      accounts: [],
    },
  ],
  fees: [{ name: 'Mensalidade', amount: 55 }],
};

describe('import mapping', () => {
  it('skips title rows and maps Sicredi-like headers', () => {
    const csv = `Extrato de Conta Corrente;;;;
Agência 1234 Conta 56789-0;;;;
Dt. Lançamento;Histórico do Lançamento;Vlr. Crédito;Vlr. Débito
14/08/2026;PIX RECEBIDO ANA SOUZA MENSALIDADE;55,00;
`;
    expect(detectHeaderIndex(csv, 'statement')).toBe(2);
    const mapping = heuristicMapping(
      ['dt_lancamento', 'historico_do_lancamento', 'vlr_credito', 'vlr_debito'],
      'statement',
    );
    expect(mapping.date).toBe('dt_lancamento');
    expect(mapping.description).toBe('historico_do_lancamento');
    expect(mapping.credit).toBe('vlr_credito');
  });

  it('remounts a bank sheet so the interpreter can absorb it', async () => {
    const csv = `Sicredi Tesouraria
Dt. Lançamento;Histórico do Lançamento;Valor R$
14/08/2026;PIX RECEBIDO ANA SOUZA MENSALIDADE;55,00
`;
    const remapped = await remapImportCsv(csv, 'statement');
    expect(remapped.table.headers).toEqual(expect.arrayContaining(['data', 'historico', 'valor']));
    expect(remapped.sample.rows[0]?.data).toBe('14/08/2026');
    expect(remapped.sample.rows[0]?.historico).toContain('ANA SOUZA');
    expect(remapped.review.ok).toBe(true);
    const result = interpretStatement(remapped.csv, catalog);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]?.amount).toBe(55);
    expect(result.rows[0]?.memberId).toBe('m-ana');
    expect(result.rows[0]?.movementTypeName).toBe('Mensalidade');
  });

  it('keeps crédito and débito as separate columns', async () => {
    const csv = `Dt. Lançamento;Histórico do Lançamento;Vlr. Crédito;Vlr. Débito
14/08/2026;PIX RECEBIDO ANA SOUZA MENSALIDADE;55,00;
`;
    const remapped = await remapImportCsv(csv, 'statement');
    expect(remapped.mapping.credit).toBe('vlr_credito');
    expect(remapped.mapping.debit).toBe('vlr_debito');
    expect(remapped.mapping.amount).toBeUndefined();
    expect(remapped.table.headers).toEqual(expect.arrayContaining(['data', 'historico', 'credito', 'debito']));
    const result = interpretStatement(remapped.csv, catalog);
    expect(result.rows[0]?.amount).toBe(55);
    expect(result.rows[0]?.type).toBe('income');
  });

  it('maps associate columns with alternative names', async () => {
    const csv = `Nome Completo;E-mail;Celular;Seção;Função;Taxa;Data cadastro;LTC
Ana Souza;ana@arnofriedrich.org.br;(51) 99999-1001;Lobinho;jovem;55,00;11/03/2023;não
`;
    const remapped = await remapImportCsv(csv, 'members');
    expect(remapped.table.rows[0]?.nome).toBe('Ana Souza');
    expect(remapped.table.rows[0]?.email).toBe('ana@arnofriedrich.org.br');
    expect(remapped.table.rows[0]?.ramo).toBe('Lobinho');
    expect(remapped.table.rows[0]?.ingresso).toBe('11/03/2023');
    expect(remapped.sample.columns.map((column) => column.field)).toEqual(
      expect.arrayContaining(['name', 'email', 'branch']),
    );
    expect(remapped.sample.rows[0]?.nome).toBe('Ana Souza');
    expect(remapped.review.ok).toBe(true);
  });

  it('keeps a second responsible when remapping associate columns', async () => {
    const csv = `nome;email;telefone;ramo;papel;mensalidade;ingresso;clube_ltc;responsavel;parentesco;responsavel_2;parentesco_2
Ana Souza;ana@arnofriedrich.org.br;(51) 99999-1001;Lobinho;jovem;55,00;11/03/2023;não;Helena Souza;Mãe;Carlos Souza;Pai
`;
    const remapped = await remapImportCsv(csv, 'members');
    expect(remapped.table.rows[0]?.responsavel).toBe('Helena Souza');
    expect(remapped.table.rows[0]?.responsavel_2).toBe('Carlos Souza');
    expect(remapped.mapping.guardianName2).toBe('responsavel_2');
  });

  it('does not let a repeated Email column wipe the associate e-mail', async () => {
    const csv = `Associado;Email;Telefone;Clube L;Papel;Ramo;Ingresso;Responsável;Parent;Telefone2;email2;Resp2;Parent2;Telefone3;Email
Ana Souza;ana@arnofriedrich.org.br;(51) 99999-1001;não;Jovem;Lobinho;11/03/2023;Helena Souza;Mãe;(51) 99999-1002;helena@arnofriedrich.org.br;Carlos Souza;Pai;(51) 99999-1003;
`;
    const remapped = await remapImportCsv(csv, 'members');
    expect(remapped.table.rows[0]?.email).toBe('ana@arnofriedrich.org.br');
    expect(remapped.table.rows[0]?.email_responsavel).toBe('helena@arnofriedrich.org.br');
    expect(remapped.table.rows[0]?.responsavel_2).toBe('Carlos Souza');
    expect(remapped.mapping.email).toBe('email');
    expect(remapped.mapping.guardianEmail).toBe('email2');
  });

  it('maps mother and father columns to the two responsible slots', async () => {
    const csv = `Nome Completo;E-mail;Celular;Seção;Função;Taxa;Data cadastro;LTC;Nome da Mãe;Nome do Pai
Ana Souza;ana@arnofriedrich.org.br;(51) 99999-1001;Lobinho;jovem;55,00;11/03/2023;não;Helena Souza;Carlos Souza
`;
    const remapped = await remapImportCsv(csv, 'members');
    expect(remapped.mapping.guardianName).toBe('nome_da_mae');
    expect(remapped.mapping.guardianName2).toBe('nome_do_pai');
    expect(remapped.table.rows[0]?.responsavel).toBe('Helena Souza');
    expect(remapped.table.rows[0]?.responsavel_2).toBe('Carlos Souza');
  });

  it('samples several rows so the treasurer can validate before import', async () => {
    const csv = `Dt. Lançamento;Histórico do Lançamento;Valor R$
14/08/2026;PIX RECEBIDO ANA SOUZA MENSALIDADE;55,00
15/08/2026;PIX RECEBIDO BRUNO DOACAO;80,00
16/08/2026;TARIFA PACOTE MENSAL;12,90
`;
    const remapped = await remapImportCsv(csv, 'statement');
    expect(remapped.sample.totalRows).toBe(3);
    expect(remapped.sample.shown).toBe(3);
    expect(remapped.sample.rows.map((row) => row.data)).toEqual(['14/08/2026', '15/08/2026', '16/08/2026']);
    expect(remapped.review.ok).toBe(true);
  });

  it('reuses a mapping on later chunks without rewriting headers', async () => {
    const first = await remapImportCsv(
      `Nome Completo;E-mail;Celular;Seção;Função;Taxa;Data cadastro;LTC
Ana Souza;ana@arnofriedrich.org.br;(51) 99999-1001;Lobinho;jovem;55,00;11/03/2023;não
`,
      'members',
    );
    const second = await remapImportCsv(
      `Nome Completo;E-mail;Celular;Seção;Função;Taxa;Data cadastro;LTC
Bruno Lima;bruno@arnofriedrich.org.br;(51) 99999-1002;Escoteiro;jovem;60,00;01/02/2024;não
`,
      'members',
      { mapping: first.mapping, review: false },
    );
    expect(second.table.rows[0]?.nome).toBe('Bruno Lima');
    expect(second.table.headers).toEqual(expect.arrayContaining(['nome', 'email']));
  });
});
