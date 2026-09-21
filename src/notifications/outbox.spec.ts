import { nextAttemptAt, queueConcurrency, queueMaxAttempts } from "./outbox";
import { summarizeDeliveries, type NotifyDelivery } from "./notify";

describe("outbox queue", () => {
  it("backs off retries exponentially up to five minutes", () => {
    const now = Date.parse("2026-09-18T12:00:00.000Z");
    expect(nextAttemptAt(1, now).toISOString()).toBe("2026-09-18T12:00:05.000Z");
    expect(nextAttemptAt(2, now).toISOString()).toBe("2026-09-18T12:00:10.000Z");
    expect(nextAttemptAt(3, now).toISOString()).toBe("2026-09-18T12:00:20.000Z");
    expect(nextAttemptAt(8, now).getTime() - now).toBe(5 * 60_000);
  });

  it("keeps concurrency and retry caps in a safe range", () => {
    expect(queueConcurrency()).toBeGreaterThanOrEqual(1);
    expect(queueConcurrency()).toBeLessThanOrEqual(10);
    expect(queueMaxAttempts()).toBeGreaterThanOrEqual(1);
  });
});

describe("summarizeDeliveries", () => {
  it("counts queued separately from sent", () => {
    const items: NotifyDelivery[] = [
      { id: "1", kind: "charge", channel: "email", status: "queued", to: "a@b.c" },
      { id: "2", kind: "charge", channel: "whatsapp", status: "skipped", to: "(sem telefone)" },
    ];
    expect(summarizeDeliveries(items)).toEqual({
      queued: 1,
      sent: 0,
      failed: 0,
      skipped: 1,
      total: 2,
    });
  });
});
