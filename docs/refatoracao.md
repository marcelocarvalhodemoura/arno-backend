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

## Fase 2 — interfaces para a infraestrutura

O domínio passa a depender de interfaces; os detalhes (S3, provedor de IA, e-mail, WhatsApp) ficam nos adaptadores.

| Porta (interface)                                     | Adaptador de produção             | Adaptador de teste    | Injeção                                                           |
| ----------------------------------------------------- | --------------------------------- | --------------------- | ----------------------------------------------------------------- |
| `FileStorage` (`src/storage/file-storage.ts`)         | `S3FileStorage`                   | `InMemoryFileStorage` | token `FILE_STORAGE` (`StorageModule`, global)                    |
| `NotificationChannel` (`src/notifications/channels/`) | `EmailChannel`, `WhatsAppChannel` | canais falsos no spec | lista passada ao `NotificationDispatcher`                         |
| `OutboxWriter` (`src/notifications/outbox-writer.ts`) | `prismaOutboxWriter`              | `FakeOutbox` no spec  | construtor do `NotificationDispatcher`                            |
| `LanguageModel` (`src/shared/ai/language-model.ts`)   | `OpenAiCompatibleModel`           | `noLanguageModel`     | parâmetro das funções de leitura (extrato, planilha, comprovante) |

- **`NotificationDispatcher`** (`NotificationsModule`, global) substitui o `if (channel === 'email') … if (channel === 'whatsapp')`.
  Um canal novo é uma classe nova que implementa `NotificationChannel`; o dispatcher não muda. O fallback para e-mail
  fora da janela de 24 h do WhatsApp ficou num lugar só.
- **`notifyReceipts`** junta o resumo de recibos que estava duplicado em `MensalidadesService.settle` e `.allocate`.
  Diferença mínima: no rateio sem nenhum canal configurado, o resumo agora conta os recibos pulados (`skipped`),
  como já fazia a quitação.
- `LedgerService`, `MensalidadesService`, `ComprovantesService` e `NotificationsService` recebem as dependências pelo
  construtor. Código que ainda não passa pelo container do Nest (webhooks do WhatsApp, sincronização do Sicredi) usa
  as instâncias padrão `notificationDispatcher`, `s3FileStorage` e `languageModel`, ou recebe a dependência por parâmetro.

## Fase 3 — repositório de lançamentos

- **`UnitOfWork`** (`src/shared/persistence/unit-of-work.ts`): uma transação do banco compartilhada pelos repositórios
  (`AsyncLocalStorage`). Pega a **mesma trava** do `mutate()` (`src/shared/persistence/lock.ts`), então uma gravação
  pontual nunca corre junto com uma regravação completa, e invalida o cache do `mutate()` ao terminar.
- **`TransactionRepository`** (porta em `src/ledger/domain/`, adaptador Prisma em `src/ledger/infra/`): grava **só o
  lançamento** (`add`, `save`, `moveToTrash`, `restoreFromTrash`), aplica a regra de mês fechado e registra o histórico.
  `loadContext` traz só o recorte do financeiro que as regras precisam (tipos, associados, responsáveis, meses fechados),
  o que permite reaproveitar as funções de domínio existentes sem ler o banco inteiro.
- **Mapeadores** de lançamento, lixeira e fechamento em `src/ledger/infra/transaction.mapper.ts` (antes, dentro do
  `finance-store`), usados pelo repositório e pelo `mutate()`.
- **Migrados para o repositório**: criar lançamento, excluir (lixeira), restaurar, anexar/remover/abrir nota.
  Editar, ratear, resolver duplicados e fechar mês continuam no `mutate()` até as fases 4 e 5.
- **Lixeira**: um job a cada 6 h apaga o que passou de 30 dias (`src/ledger/trash-purge.ts`); antes isso só acontecia
  de carona em alguma gravação.
- **Correção de cache**: uma leitura lenta do `loadDb()` podia gravar no cache um financeiro desatualizado depois de uma
  escrita (era a causa da instabilidade nos testes de configuração). Agora cada escrita incrementa uma versão, e a
  leitura só entra no cache se nenhuma escrita aconteceu enquanto ela rodava.
- **Teste novo**: criar, excluir e restaurar lançamento não muda o `xmin` de `members`, `movement_types` e `settings`
  (prova de que essas tabelas não foram regravadas).

Bench depois da fase (banco de teste com ~3.300 lançamentos):

| Operação                  | antes                           | depois                                           |
| ------------------------- | ------------------------------- | ------------------------------------------------ |
| `POST /transactions`      | 414 ms (com ~1.290 lançamentos) | **12 ms**                                        |
| `PATCH /transactions/:id` | 412 ms (com ~1.290 lançamentos) | 906 ms (ainda no `mutate()`, cresce com o banco) |

## Fase 4 — entidade e eventos de domínio

- **`LedgerEntry`** (`src/ledger/domain/ledger-entry.ts`): o lançamento com as suas regras — `open` (tipo ativo e
  direção aceita, pago por padrão, valor em `Money`), `changeKind`, `changeAmount`, `changePayment`, `assign`, `touch`.
  Envolve o registro `Transaction` que é persistido, então o resto do código continua lendo o mesmo formato.
  `createTransaction` e `updateTransaction` agora são uma sequência de chamadas da entidade.
- **Eventos de domínio** (`src/shared/domain/domain-events.ts`): síncronos e em memória; o handler roda dentro da mesma
  gravação de quem publicou. Eventos do caixa em `src/ledger/domain/events.ts`:
  - `TransactionPaid` — um lançamento virou pago (com a parcela de acordo que ele quita, se houver);
  - `TransactionPaymentChanged` — mudou a situação ou a data de pagamento.
- **O acordo de atrasados reage aos eventos** (`src/arrears/arrears.events.ts`). As 6 chamadas diretas a
  `registerArrearsInstallmentPaid` (caixa, quitação de mensalidade, rateio, conciliação) viraram
  `TransactionPaid`; a dissolução do rateio mensalidade + acordo reage a `TransactionPaymentChanged`.
  O domínio do caixa (`src/ledger/transactions.ts`) não importa mais `arrears`. Resta `ledger.service.ts` usar
  `resolveArrearsTxMarker` para decorar a listagem (leitura).
- Os handlers são registrados pelo `ArrearsModule`; specs que dependem dessa reação importam `arrears.events`.

## Fase 5 — fim do TRUNCATE

- **`mutate()` grava só o que mudou** (`src/shared/persistence/finance-writer.ts`). Antes: `TRUNCATE` de 14 tabelas e
  regravação de tudo a cada escrita. Agora: as linhas antes e depois da operação são comparadas tabela por tabela e só
  saem `DELETE`/`INSERT`/`UPDATE` das que mudaram (apaga filhas antes das mães, insere mães antes das filhas).
  Funciona como o rastreamento de mudanças de um ORM, sem reescrever as funções de domínio.
- **Proteção contra apagar em massa**: uma gravação que apagaria mais da metade de uma tabela (com mais de 20 linhas)
  é recusada. Antes, um array esvaziado por bug apagava a tabela inteira sem aviso.
- **Versão do financeiro no banco** (migração `20261009120000_finance_version`): gatilhos incrementam
  `finance_version.version` a cada escrita em qualquer tabela financeira, por qualquer caminho (API, scripts, SQL).
  - `loadDb()` confere a versão (uma consulta pequena) antes de usar o cache: outra instância da API ou um script que
    gravou no banco não deixam mais leituras desatualizadas.
  - `mutate()` parte da última gravação deste processo quando a versão não mudou, em vez de reler o banco inteiro.
- **Reset do admin** sem `TRUNCATE`: apaga com `deleteMany` dentro de uma transação.
- **Testes novos**: um `mutate()` sem mudança não altera o `xmin` de nenhuma tabela; editar um lançamento só regrava
  a tabela de lançamentos; unidade do comparador e da proteção contra apagar em massa.

O que continua: o `mutate()` segue como unidade de trabalho das operações que mexem em vários agregados de uma vez
(mensalidades, acordos, importação de extrato, rateio). Quando outra escrita aconteceu desde a última dele, ainda relê
o financeiro inteiro antes de aplicar a operação — é o custo que sobra no `PATCH /transactions/:id`.

| Operação (bench)          | início                     | fase 3         | fase 5         |
| ------------------------- | -------------------------- | -------------- | -------------- |
| `POST /transactions`      | 414 ms                     | 12 ms          | 11 ms          |
| `PATCH /transactions/:id` | 412 ms (1.290 lançamentos) | 906 ms (3.300) | 458 ms (4.000) |

## Fase 6 — contrato compartilhado com o frontend

- **`src/contract/`**: tipos, constantes e regras que backend e frontend usam, sem nenhuma dependência fora da pasta
  (um teste garante isso):
  - `types.ts` — 59 tipos e constantes que estavam duplicados e idênticos nos dois lados (ramos, papéis, tipos de
    movimentação, associados, acordos, relatórios, dashboard...). `shared/types.ts` reexporta.
  - `fee-rules.ts` — cálculo da mensalidade (período vigente, valor especial de família, no prazo/atraso, clube,
    diluição, valores oficiais). `mensalidades/fee-table.ts` reexporta e guarda só o que depende do banco.
  - `money.ts`, `competencia.ts`, `errors.ts` — `Money` e `Competencia` (os de `shared/domain` reexportam).
    `ContractViolation` responde 400, como os erros de domínio.
- **No frontend**: `src/contract/` é uma cópia gerada por `npm run sync:contract` (lê `../arno-backend` ou
  `ARNO_BACKEND_DIR`). Cada arquivo leva o hash do conteúdo; `npm run check:contract` (no CI) e um teste unitário
  falham se alguém editar a cópia à mão.
- **Fluxo para mudar uma regra**: altere em `arno-backend/src/contract`, rode `npm run sync:contract` no frontend e
  publique os dois PRs.
