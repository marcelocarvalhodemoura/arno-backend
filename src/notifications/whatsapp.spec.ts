import {
  digitsPhone,
  handleWhatsAppEvents,
  hubChallenge,
  isWhatsAppAccount,
  parseWhatsAppWebhook,
  verifyWebhook,
  whatsappStatus,
  whatsappWebhookUrl,
} from "./whatsapp";

const keys = [
  "WHATSAPP_TOKEN",
  "WHATSAPP_PHONE_NUMBER_ID",
  "WHATSAPP_BUSINESS_ACCOUNT_ID",
  "WHATSAPP_VERIFY_TOKEN",
  "WHATSAPP_FINANCE_NUMBER",
  "PUBLIC_URL",
] as const;

const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));

afterEach(() => {
  for (const key of keys) {
    const value = previous[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("whatsapp webhook", () => {
  it("normalizes Brazilian phone numbers", () => {
    expect(digitsPhone("(51) 99999-1002")).toBe("5551999991002");
    expect(digitsPhone("5551999991002")).toBe("5551999991002");
  });

  it("reads hub challenge query params", () => {
    expect(
      hubChallenge({
        "hub.mode": "subscribe",
        "hub.verify_token": "segredo",
        "hub.challenge": "42",
      }),
    ).toEqual({ mode: "subscribe", token: "segredo", challenge: "42" });
    expect(
      hubChallenge({
        hub: { mode: "subscribe", verify_token: "segredo", challenge: "42" },
      }),
    ).toEqual({ mode: "subscribe", token: "segredo", challenge: "42" });
    expect(
      hubChallenge({
        hub_mode: "subscribe",
        hub_verify_token: "segredo",
        hub_challenge: "42",
      }),
    ).toEqual({ mode: "subscribe", token: "segredo", challenge: "42" });
  });

  it("accepts Meta verification only with the configured token", () => {
    process.env.WHATSAPP_VERIFY_TOKEN = "segredo-meta";
    expect(verifyWebhook("subscribe", "segredo-meta")).toBe(true);
    expect(verifyWebhook("subscribe", "errado")).toBe(false);
    expect(verifyWebhook("unsubscribe", "segredo-meta")).toBe(false);
    delete process.env.WHATSAPP_VERIFY_TOKEN;
    expect(verifyWebhook("subscribe", "segredo-meta")).toBe(false);
  });

  it("parses incoming text messages from a WhatsApp Business payload", () => {
    const body = {
      object: "whatsapp_business_account",
      entry: [
        {
          id: "1368897791894502",
          changes: [
            {
              field: "messages",
              value: {
                messaging_product: "whatsapp",
                metadata: { phone_number_id: "1230086313532514" },
                contacts: [{ profile: { name: "Helena Souza" }, wa_id: "5551999991002" }],
                messages: [
                  {
                    from: "5551999991002",
                    id: "wamid.HBgNNTU1MTk5OTk5MTAwMgUCABIYFjNFQjBDN0Ew",
                    timestamp: "1726600000",
                    type: "text",
                    text: { body: "Mensalidade paga" },
                  },
                ],
              },
            },
          ],
        },
      ],
    };
    expect(isWhatsAppAccount({ object: "whatsapp_business_account" })).toBe(true);
    expect(isWhatsAppAccount({ object: "page" })).toBe(false);
    expect(parseWhatsAppWebhook(body)).toEqual([
      {
        phoneNumberId: "1230086313532514",
        from: "5551999991002",
        id: "wamid.HBgNNTU1MTk5OTk5MTAwMgUCABIYFjNFQjBDN0Ew",
        timestamp: "1726600000",
        type: "text",
        text: "Mensalidade paga",
        contactName: "Helena Souza",
      },
    ]);
    expect(handleWhatsAppEvents(body)).toEqual({ received: 1 });
  });

  it("reports configuration without exposing secrets", () => {
    process.env.WHATSAPP_TOKEN = "token";
    process.env.WHATSAPP_PHONE_NUMBER_ID = "123";
    process.env.WHATSAPP_VERIFY_TOKEN = "segredo";
    process.env.PUBLIC_URL = "https://tesouraria.exemplo.org/";
    expect(whatsappStatus()).toEqual({ configured: true, webhookReady: true });
    expect(whatsappWebhookUrl()).toBe("https://tesouraria.exemplo.org/webhook");
  });
});
