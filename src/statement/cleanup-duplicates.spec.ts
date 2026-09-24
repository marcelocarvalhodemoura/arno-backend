import { planDuplicateRemovals } from './cleanup-duplicates';

describe('cleanupDuplicateTransactions plan', () => {
  const identify = new Set(['mt-identify']);

  it('drops a plain identify launch that duplicates a rateio', () => {
    const groupId = 'g1';
    const created = new Date('2026-09-23T18:00:00.000Z');
    const plan = planDuplicateRemovals(
      [
        {
          id: 'orphan',
          date: new Date('2026-09-08'),
          type: 'income',
          description: 'RECEBIMENTO PIX 64588955004 Cláudia soneborn Alm PIX_CRED',
          amount: 164,
          origin: 'integration',
          memberId: null,
          externalId: null,
          splitGroupId: null,
          splitIndex: null,
          splitTotal: null,
          movementTypeId: 'mt-identify',
          createdAt: new Date('2026-09-24T12:27:00.000Z'),
        },
        {
          id: 'part1',
          date: new Date('2026-09-10'),
          type: 'income',
          description:
            'LUCAS · parte 1/2 · R$ 82,00 de R$ 164,00 · RECEBIMENTO PIX 64588955004 Cláudia soneborn Alm PIX_CRED',
          amount: 82,
          origin: 'integration',
          memberId: 'm1',
          externalId: null,
          splitGroupId: groupId,
          splitIndex: 1,
          splitTotal: 164,
          movementTypeId: 'mt-men',
          createdAt: created,
        },
        {
          id: 'part2',
          date: new Date('2026-09-08'),
          type: 'income',
          description:
            'RENATA · parte 2/2 · R$ 82,00 de R$ 164,00 · RECEBIMENTO PIX 64588955004 Cláudia soneborn Alm PIX_CRED',
          amount: 82,
          origin: 'integration',
          memberId: 'm2',
          externalId: null,
          splitGroupId: groupId,
          splitIndex: 2,
          splitTotal: 164,
          movementTypeId: 'mt-men',
          createdAt: created,
        },
      ],
      identify,
    );
    expect(plan).toHaveLength(1);
    expect(plan[0]?.keepId).toBe('part1');
    expect(plan[0]?.dropIds).toEqual(['orphan']);
  });

  it('does not merge different payers with the same amount and day', () => {
    const day = new Date('2026-01-05');
    const plan = planDuplicateRemovals(
      [
        {
          id: 'a',
          date: day,
          type: 'income',
          description: 'RECEBIMENTO PIX 11111111111 JOANA EXEMPLO PIX_CRED',
          amount: 60,
          origin: 'integration',
          memberId: null,
          externalId: null,
          splitGroupId: null,
          splitIndex: null,
          splitTotal: null,
          movementTypeId: 'mt-identify',
          createdAt: day,
        },
        {
          id: 'b',
          date: day,
          type: 'income',
          description: 'RECEBIMENTO PIX 22222222222 MARIA SILVA PIX_CRED',
          amount: 60,
          origin: 'integration',
          memberId: null,
          externalId: null,
          splitGroupId: null,
          splitIndex: null,
          splitTotal: null,
          movementTypeId: 'mt-identify',
          createdAt: day,
        },
      ],
      identify,
    );
    expect(plan).toHaveLength(0);
  });
});
