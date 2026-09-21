import { interpretStatement, isUnidentifiedName, matchMember } from "./statement";

const catalog = {
  movementTypes: [
    { id: "mt-men", name: "Mensalidade", direction: "income", active: true },
    { id: "mt-doa", name: "Doação", direction: "income", active: true },
    { id: "mt-uti", name: "Utilidades", direction: "expense", active: true },
    { id: "mt-sede", name: "Sede", direction: "expense", active: true },
    { id: "mt-out", name: "Outros", direction: "both", active: true },
  ],
  members: [
    {
      id: "m-ana",
      name: "Ana Souza",
      branch: "lobinho" as const,
      monthlyFee: 55,
      accounts: [{ holderName: "Carla Souza", pixKey: "carla.souza@pix" }],
      guardians: [{ id: "g-helena", name: "Helena Souza" }],
    },
    {
      id: "m-pedro",
      name: "Pedro Lima",
      branch: "lobinho" as const,
      monthlyFee: 55,
      accounts: [],
    },
    {
      id: "m-lucas",
      name: "Lucas Exemplo",
      branch: "escoteiro" as const,
      monthlyFee: 60,
      accounts: [{ holderName: "Joana Exemplo", pixKey: "11111111111", document: "111.111.111-11" }],
      guardians: [{ id: "g-joana", name: "Joana Exemplo" }],
    },
  ],
  fees: [{ name: "Mensalidade", amount: 55 }],
};

describe("interpretStatement", () => {
  it("keeps the tesouraria template", () => {
    const result = interpretStatement(
      `data;tipo;natureza;tipo_movimentacao;descricao;valor;ramo;meio;situacao;associado
14/09/2026;entrada;variável;Doação;Doação Pix;150,00;grupo;pix;pago;Ana Souza
`,
      catalog,
    );
    expect(result.layout).toBe("template");
    expect(result.rows[0]?.movementTypeId).toBe("mt-doa");
    expect(result.rows[0]?.memberId).toBe("m-ana");
    expect(result.rows[0]?.confidence).toBe("high");
  });

  it("matches the late mensalidade amount from the poster", () => {
    const result = interpretStatement(
      `Data;Histórico;Valor
11/09/2026;PIX RECEBIDO ANA SOUZA MENSALIDADE;99,50
`,
      catalog,
    );
    expect(result.rows[0]?.movementTypeName).toBe("Mensalidade");
    expect(result.rows[0]?.memberId).toBe("m-ana");
    expect(result.rows[0]?.amount).toBe(99.5);
  });

  it("classifies a bank statement with pix and associate", () => {
    const result = interpretStatement(
      `Data;Histórico;Valor
14/09/2026;PIX RECEBIDO ANA SOUZA MENSALIDADE;55,00
14/09/2026;PAGAMENTO ENERGISA SEDE;-180,40
14/09/2026;SALDO ANTERIOR;4000,00
`,
      catalog,
    );
    expect(result.layout).toBe("bank");
    expect(result.rows).toHaveLength(2);
    const fee = result.rows.find((row) => row.amount === 55);
    expect(fee?.movementTypeName).toBe("Mensalidade");
    expect(fee?.memberId).toBe("m-ana");
    expect(fee?.branch).toBe("lobinho");
    expect(fee?.type).toBe("income");
    const bill = result.rows.find((row) => row.amount === 180.4);
    expect(bill?.type).toBe("expense");
    expect(bill?.movementTypeName).toBe("Utilidades");
    expect(bill?.method).toBe("pix");
  });

  it("links a launched youth guardian from the bank history", () => {
    const result = interpretStatement(
      `Data;Histórico;Valor
14/09/2026;PIX RECEBIDO HELENA SOUZA MENSALIDADE;55,00
`,
      catalog,
    );
    expect(result.rows[0]?.memberId).toBe("m-ana");
    expect(result.rows[0]?.memberGuardianId).toBe("g-helena");
    expect(result.rows[0]?.memberGuardianName).toBe("Helena Souza");
  });

  it("reads credit and debit columns", () => {
    const result = interpretStatement(
      `data;historico;credito;debito
01/08/2026;PIX DOACAO FAMILIA;150,00;
01/08/2026;TED ALUGUEL SEDE;;900,00
`,
      catalog,
    );
    expect(result.rows[0]?.type).toBe("income");
    expect(result.rows[0]?.amount).toBe(150);
    expect(result.rows[1]?.type).toBe("expense");
    expect(result.rows[1]?.amount).toBe(900);
    expect(result.rows[1]?.method).toBe("transfer");
  });

  it("matches CPF and guardian on a Sicredi PIX and treats it as paid mensalidade", () => {
    const result = interpretStatement(
      `data;historico;valor;tipo
05/01/2026;RECEBIMENTO PIX 11111111111 JOANA EXEMPLO PIX_CRED;60,00;entrada
`,
      catalog,
    );
    expect(result.rows[0]?.memberId).toBe("m-lucas");
    expect(result.rows[0]?.memberGuardianId).toBe("g-joana");
    expect(result.rows[0]?.movementTypeName).toBe("Mensalidade");
    expect(result.rows[0]?.paymentStatus).toBe("paid");
    expect(result.rows[0]?.confidence).toBe("high");
  });

  it("still imports unidentified bank lines for later classification", () => {
    const result = interpretStatement(
      `Data;Histórico;Valor
20/01/2026;PIX RECEBIDO FULANO DESCONHECIDO;99,00
`,
      catalog,
    );
    expect(result.rows[0]?.movementTypeName).toBe("Outros");
    expect(result.rows[0]?.memberId).toBeUndefined();
    expect(result.rows[0]?.confidence).toBe("low");
    expect(result.rows[0]?.error).toBeUndefined();
    expect(result.rows[0]?.hint).toMatch(/conferir o tipo/i);
  });
});

describe("isUnidentifiedName", () => {
  it("detects the catch-all type used for later classification", () => {
    expect(isUnidentifiedName("A identificar")).toBe(true);
    expect(isUnidentifiedName("Outros")).toBe(false);
  });
});

describe("matchMember", () => {
  it("matches holder pix keys", () => {
    const hit = matchMember("PIX RECEBIDO carla.souza@pix", catalog.members);
    expect(hit?.member.id).toBe("m-ana");
  });

  it("matches a youth guardian name on launched bank lines", () => {
    const hit = matchMember("PIX RECEBIDO HELENA SOUZA MENSALIDADE", catalog.members);
    expect(hit?.member.id).toBe("m-ana");
    expect(hit?.guardian?.id).toBe("g-helena");
  });

  it("matches a payment account CPF", () => {
    const hit = matchMember("RECEBIMENTO PIX 11111111111 JOANA EXEMPLO PIX_CRED", catalog.members);
    expect(hit?.member.id).toBe("m-lucas");
    expect(hit?.guardian?.id).toBe("g-joana");
  });
});
