import {
  composeNotifyMessage,
  escapeHtml,
  FINANCE_WHATSAPP_DISPLAY,
  firstName,
  GROUP_CNPJ,
} from "./templates";
import type { DatabaseShape, Member, Transaction } from "../shared/types";

function member(partial: Partial<Member> & Pick<Member, "id" | "name">): Member {
  return {
    email: "ana@arnofriedrich.org.br",
    phone: "",
    branch: "escoteiro",
    role: "jovem",
    monthlyFee: 89.5,
    status: "active",
    joinedAt: "2026-03-01",
    clubeLtc: false,
    origin: "manual",
    createdAt: "2026-03-01T00:00:00.000Z",
    ...partial,
  };
}

function tx(partial: Partial<Transaction> & Pick<Transaction, "date" | "amount">): Transaction {
  return {
    id: "t1",
    type: "income",
    nature: "fixed",
    movementTypeId: "mt-men",
    description: "Mensalidade",
    branch: "escoteiro",
    method: "pix",
    paymentStatus: "pending",
    memberId: "m1",
    origin: "manual",
    createdAt: "2026-03-01T00:00:00.000Z",
    ...partial,
  };
}

function db(members: Member[]): DatabaseShape {
  return {
    members,
    memberGuardians: [],
    memberAccounts: [],
    movementTypes: [],
    fees: [],
    projects: [],
    transactions: [],
    settings: { openingBalance: 0, groupName: "Grupo Escoteiro Arno Friedrich" },
  };
}

describe("charge email template", () => {
  it("escapes html and greets by first name", () => {
    expect(escapeHtml(`Ana <tropa> & "43"`)).toBe("Ana &lt;tropa&gt; &amp; &quot;43&quot;");
    expect(firstName("Helena Souza")).toBe("Helena");
  });

  it("builds a branded HTML charge that highlights punctuality", () => {
    const ana = member({ id: "m1", name: "Ana Souza" });
    const message = composeNotifyMessage(db([ana]), tx({ date: "2099-10-10", amount: 89.5 }), "charge", "Helena Souza");
    expect(message.subject).toContain("Mensalidade de outubro 2099");
    expect(message.subject).not.toContain("em aberto");
    expect(message.text).toContain("Olá, Helena.");
    expect(message.text).toContain("Ana Souza");
    expect(message.text).toContain("Pague até o dia 10");
    expect(message.html).toContain("43/RS · Tesouraria");
    expect(message.html).toContain("Olá, Helena.");
    expect(message.html).toContain("Ramo Escoteiro");
    expect(message.html).toContain("Pagar por Pix");
    expect(message.html).toContain("Pague até o dia");
    expect(message.html).toMatch(/R\$(\u00a0|&nbsp;|\s*)89,50/);
    expect(message.html).not.toContain("<tropa>");
  });

  it("marks overdue charges without sounding like a threat", () => {
    const ana = member({ id: "m1", name: "Ana Souza" });
    const message = composeNotifyMessage(db([ana]), tx({ date: "2026-09-10", amount: 99.5 }), "charge", "Helena Souza");
    expect(message.subject).toContain("em aberto");
    expect(message.html).toContain("Em aberto após o vencimento");
    expect(message.html).toContain("próximo mês");
    expect(message.text).toContain("prazo de pontualidade");
  });

  it("shows the group logo, CNPJ Pix key and finance WhatsApp", () => {
    const ana = member({ id: "m1", name: "Ana Souza", clubeLtc: true });
    const message = composeNotifyMessage(db([ana]), tx({ date: "2099-11-10", amount: 75 }), "charge", "Ana Souza");
    expect(message.html).toContain(GROUP_CNPJ);
    expect(message.html).toContain("corresponde ao CNPJ");
    expect(message.html).toContain(FINANCE_WHATSAPP_DISPLAY);
    expect(message.html).toContain("desconsidere esta mensagem");
    expect(message.text).toContain(GROUP_CNPJ);
    expect(message.text).toContain(FINANCE_WHATSAPP_DISPLAY);
    expect(message.html).toContain("Clube da Flor de Lis");
  });
});
