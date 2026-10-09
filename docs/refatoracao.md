# Refatoração: SOLID, Clean Code e DDD

Roteiro em fases. Cada fase é um PR que vai para produção sozinho.

| Fase | Conteúdo                                                                                            |
| ---- | --------------------------------------------------------------------------------------------------- |
| 0    | Rede de segurança: testes de caracterização, bench de escrita, backup verificado                    |
| 1    | Fundações: erros de domínio, `AppConfig`, utilitários de data em `shared/`, `Money` e `Competencia` |
| 2    | Interfaces para a infraestrutura: `NotaStorage`, canais de notificação                              |
| 3    | Repositório de lançamentos + Unit of Work (sem TRUNCATE para lançamentos)                           |
| 4    | Entidade `Transaction` e evento `TransactionPaid`                                                   |
| 5    | Demais módulos fora do `mutate()`; remoção do TRUNCATE                                              |
| 6    | Tipos e regras compartilhados com o frontend                                                        |
| 7    | Frontend: páginas grandes divididas                                                                 |

## Fase 0 — rede de segurança

### Testes de caracterização

`test/integration/characterization.int-spec.ts` congela status HTTP, mensagens e efeitos de:
lançar/editar/listar, rateio, notas sem S3, fechamento de mês, lixeira, duplicados, acordos de atrasados,
quitação de mensalidade e integridade da gravação (uma escrita não apaga outras tabelas).

Comportamento atual registrado como está (a corrigir na fase 1):

- `PATCH /api/transactions/:id` de um id inexistente responde **400 "Http Exception"**: o `fail(404)` é lançado
  dentro do `try` do service e capturado pelo `catch`.

### Bench de escrita

```bash
yarn test:bench            # BENCH_ROUNDS=50 para mais amostras
```

Referência medida antes da refatoração (banco de teste local, ~1.290 lançamentos, 167 associados):

| Operação                  | média  | p95    |
| ------------------------- | ------ | ------ |
| `POST /transactions`      | 414 ms | 475 ms |
| `PATCH /transactions/:id` | 412 ms | 441 ms |
| `GET /transactions` (mês) | 3,4 ms | 5,1 ms |

O custo da escrita cresce com o tamanho do banco: cada escrita relê e regrava todas as tabelas financeiras.

### Backup

```bash
yarn db:backup --verify                                  # usa DATABASE_URL
PG_DOCKER_IMAGE=postgres:16-alpine yarn db:backup --verify   # quando o pg_dump local é mais antigo que o servidor
```

Gera `backups/<banco>-<data>.dump`, restaura num banco temporário e compara as contagens das tabelas principais.
**Rodar contra produção antes de publicar as fases 3 e 5.**

## Fase 1 — fundações

- **Erros de domínio** (`src/shared/domain/errors.ts`): `BusinessRuleViolation` (400), `NotFound` (404), `Conflict` (409).
  O `AllExceptionsFilter` responde `{ error }` com o status de cada um. Os services deixaram de ter try/catch só para
  traduzir erro; os que sobraram envolvem infraestrutura (S3, Sicredi, leitura de extrato).
- **Correções que vieram junto**: editar lançamento ou associado inexistente agora responde 404 (antes, 400 "Http Exception").
  Mensagens de "não encontrado" vindas do domínio passam a responder 404 em todos os endpoints.
  Erros inesperados (bug) passam a responder 500 "Erro interno" em vez de 400 com a mensagem técnica.
- **`AppConfig`** (`src/shared/config.ts`): único ponto de leitura de `process.env` (exceto `migrate.ts`, que repassa o
  ambiente ao Prisma). Na subida, avisa se `AUTH_SECRET` está faltando em produção.
- **Datas** em `src/shared/dates.ts` (`todayISO`, `pad2`, `lastDayOfMonth`, `dayAfterISO`, `nextMonthStart`): o ledger e as
  notificações não importam mais `mensalidades` só por causa de datas.
- **Value objects** `Money` (centavos inteiros, `allocate` sem perder centavo) e `Competencia` (AAAA-MM), com testes.
  A adoção no domínio acontece na fase 4.
