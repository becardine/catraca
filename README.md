# Catraca

Venda de ingressos para eventos pequenos (shows em bar, workshops, meetups), construída em modo agente
com Spec-Driven Development: PRD → spec, plano e contrato por feature → implementação por agente →
avaliação por um agente independente, com outra ferramenta sempre que possível.

> Status: as 7 features estão concluídas e aprovadas por avaliação independente (veja
> [`project-state.json`](project-state.json)). A verificação final de release é registrada em
> [`docs/release/reports/`](docs/release/reports/).

| Feature | Wave |
|---|---|
| F01 Contas e acesso | 1 |
| F02 Gestão de eventos e vitrine | 2 |
| F03 Compra de ingressos e gateway simulado | 3 |
| F04 API de parceiros | 4 (paralela) |
| F05 Check-in | 4 (paralela) |
| F06 Painel do evento | 4 (paralela) |
| F07 Cancelamento de evento | 5 |

## Como rodar

**Pré-requisitos:** Docker (com Docker Compose v2), Node.js LTS (≥ 20) e Git. Nenhuma chave de pagamento
é necessária: o gateway é simulado.

| Ação | Comando |
|---|---|
| Subir tudo (build, banco, migrations e seed) | `npm run up` |
| Derrubar tudo | `npm run down` |
| Derrubar e apagar o banco | `npm run down -- --reset` |
| Rodar os gates (lint, typecheck, build e testes) | `npm run gates` |

Os comandos usam apenas o Node e o Docker. Não é preciso rodar `npm install` antes de `npm run up`:
o build acontece dentro do container. O `npm run gates` instala as dependências sozinho se faltarem e
roda os testes num Postgres descartável e isolado, sem mexer nos dados do ambiente que está de pé.

O modo padrão usa o gateway simulado com os tempos do brief (final `0001`: aprovado em 2–5 s; `0003`:
aprovado em 30–40 s; etc.). Só os testes automatizados aceleram esses tempos.

## Endereços

| Nome | Endereço |
|---|---|
| `$WEB` (produto) | http://localhost:3000 |
| `$API` (base da API de parceiros) | http://localhost:3000 — rotas em `/api/partner/...` |

A única porta aberta é a 3000. Para inspecionar o banco: `docker compose exec db psql -U catraca`.

## Credenciais (seed)

| Papel | E-mail | Senha |
|---|---|---|
| Organizador A | `org.a@catraca.test` | `catraca123` |
| Organizador B | `org.b@catraca.test` | `catraca123` |
| Participante | `participante@catraca.test` | `catraca123` |

**Chave de parceiro** (`$KEY`, cabeçalho `X-Api-Key`): `catraca-partner-dev-key`

A seed roda a cada subida e é idempotente: subir de novo não duplica nada e as senhas continuam as mesmas.

## Mapa dos artefatos

| Artefato | Onde |
|---|---|
| Brief original | [`docs/brief.md`](docs/brief.md) |
| PRD (7 features, provides/consumes, grafo, waves, critérios, fora de escopo) | [`docs/prd.md`](docs/prd.md) |
| Pasta de cada feature (spec, plano, contrato e relatórios) | [F01](docs/features/F01-accounts/) · [F02](docs/features/F02-events/) · [F03](docs/features/F03-purchase/) · [F04](docs/features/F04-partner-api/) · [F05](docs/features/F05-checkin/) · [F06](docs/features/F06-dashboard/) · [F07](docs/features/F07-cancellation/) |
| Relatórios de verificação de release (PRD §9) | [`docs/release/reports/`](docs/release/reports/) |
| Templates (spec, plano, contrato, relatório) | [`docs/templates/`](docs/templates/) |
| Arquivo de estado | [`project-state.json`](project-state.json) |
| Porta de entrada dos agentes | [`AGENTS.md`](AGENTS.md) (o [`CLAUDE.md`](CLAUDE.md) aponta para ele) |
| PRs da wave paralela (wave 4) | [#6 F04](https://github.com/becardine/catraca/pull/6), [#7 F05](https://github.com/becardine/catraca/pull/7), [#8 F06](https://github.com/becardine/catraca/pull/8) |

Todos os PRs, por feature: [#3 F01](https://github.com/becardine/catraca/pull/3), [#4 F02](https://github.com/becardine/catraca/pull/4),
[#5 F03](https://github.com/becardine/catraca/pull/5), #6–#8 (wave 4), [#9 F07](https://github.com/becardine/catraca/pull/9).

### A wave paralela (wave 4)

F04, F05 e F06 foram implementadas **ao mesmo tempo**. Cada uma tinha a sua branch e a sua worktree
(`.worktrees/<ID>`), com stack e gates isolados (`COMPOSE_PROJECT_NAME`, `APP_PORT`, `GATES_PROJECT`,
`GATES_DB_PORT`). A F04 e a F06 foram implementadas pelo Claude Code e a F05 pelo Codex, e as três
foram integradas por PR. Os commits mostram a sobreposição:

| PR | Primeiro commit | Último commit |
|---|---|---|
| #6 F04 | 20:37:20 UTC (commit base do harness, compartilhado pelas três) | 20:56:34 UTC |
| #7 F05 | 20:39:46 UTC | 21:13:18 UTC |
| #8 F06 | 20:39:46 UTC | 21:15:42 UTC |

O primeiro commit de cada PR é anterior ao último commit dos outros. Os conflitos de merge previstos
(`src/app.ts`, com o registro de cada feature, e a tabela deste README) foram resolvidos mantendo os
dois lados. Depois de cada resolução, rodamos os gates e um teste de integração entre as features.

## Decisões

- **Stack: Node.js 22 + TypeScript, Fastify, PostgreSQL 16 e Docker Compose.** O Node já está na máquina
  do avaliador, então os scripts de subir, derrubar e gates são Node puro (sem bash) e rodam igual em
  Linux, macOS e Windows. O Postgres oferece transações e lock de linha, que resolvem a lotação sob
  concorrência sem nenhuma infraestrutura extra (fila, Redis). Um único servidor atende a interface (HTML
  renderizado no servidor) e a API de parceiros, porque menos peças significam menos pontos onde as
  features podem se desencontrar.

- **Como a R07 foi garantida sob concorrência.** Toda compra, da vitrine ou da API, passa pela mesma
  função `purchaseTicket` (`src/tickets/purchase.ts`). Dentro de uma transação, ela:
  1. trava a linha do evento com `SELECT … FROM events WHERE id = $1 FOR UPDATE`;
  2. conta as vagas ocupadas (pendentes + confirmados);
  3. insere o ingresso pendente só se houver vaga.

  Compras simultâneas do mesmo evento ficam em fila nesse lock, e cada uma enxerga o resultado já gravado
  da anterior, então as vagas ocupadas nunca passam da lotação. A edição de lotação (R03) usa o mesmo
  lock, então uma redução não escapa entre duas compras. Descartamos as alternativas:
  - `SERIALIZABLE` com retentativas: tempestade de retries numa rajada.
  - Contador de vagas numa coluna: uma segunda fonte de verdade.
  - `INSERT … WHERE count < lotação` sem lock: não é seguro em READ COMMITTED.

  **A prova:**
  - Um teste nos gates dispara 30 compras simultâneas em 5 eventos novos de lotação 5 e exige exatamente
    5 sucessos e 25 `sold_out` em cada um. O mesmo teste corre pela API em 2 eventos.
  - Os avaliadores repetiram a rajada do brief (`seq 30 | xargs -P 30 curl …`) no ambiente real.
  - A verificação de release repete a rajada em pelo menos 5 eventos.

- **Como a resposta assíncrona do gateway foi implementada.**
  1. A compra grava, na mesma transação, o ingresso `pending` e um **job persistido** (`payment_jobs`)
     com o resultado simulado (pelo final do cartão) e o horário da resposta (`due_at`), e responde na
     hora: `202` na API, redirect na vitrine.
  2. Um worker no mesmo processo consulta os jobs vencidos a cada 200 ms, com `FOR UPDATE SKIP LOCKED`,
     e aplica o resultado com um update condicional:
     `UPDATE tickets SET status = … WHERE id = $1 AND status = 'pending'`.
  3. Por isso, uma resposta que chega depois do cancelamento não muda nada (R11), e os jobs sobrevivem a
     um restart do app, porque vivem no banco e não em `setTimeout`.

  Os tempos seguem o brief (`GATEWAY_DELAY_SCALE=1` por padrão). Só os testes usam uma escala menor.

- **Como a avaliação foi isolada do implementador.**
  - Cada avaliação roda numa **sessão nova, com contexto vazio**, que recebe só o `AGENTS.md`, o contrato e
    o SHA do commit, sobe o ambiente do zero e executa cada item do contrato.
  - **Quem avalia é a outra ferramenta:** o Codex CLI (`codex exec --ephemeral`) avaliou o que o Claude Code
    implementou. A F05, implementada pelo Codex, foi avaliada por um subagente novo do Claude Code, que não
    leu o código da feature.
  - Antes da implementação, o futuro avaliador **revisa o contrato**, apontando itens não verificáveis ou
    critérios sem cobertura.
  - Cada avaliação grava um **relatório novo e imutável** em `docs/features/<ID>/reports/`, com data, commit,
    quem implementou, quem avaliou (ferramenta e modelo) e a evidência de cada item. Implementadores nunca
    editam relatórios, e avaliadores nunca editam código.
  - Para conferir que um relatório nunca foi alterado: `git log --format="%h %ad" --date=iso -- <relatório>`
    mostra um único commit.

### Quem fez o quê

Usamos duas ferramentas: Claude Code (`claude-opus-5-5`) e Codex CLI (`gpt-6`). Cada commit de agente traz
os trailers `Agent-Tool`, `Agent-Model` e `Agent-Role` (implementer, evaluator ou author), e cada relatório
registra quem implementou e quem avaliou. Para listar os commits por ferramenta:

```sh
git log --format='%h %s | %(trailers:key=Agent-Tool,valueonly,separator=%x2C)'
```

| Feature | Implementado por | Avaliado por | Relatório mais recente |
|---|---|---|---|
| Harness | Claude Code (claude-opus-5-5) | — | — |
| F01 Contas e acesso | Claude Code (claude-opus-5-5) | Codex CLI (gpt-6) | [relatório](docs/features/F01-accounts/reports/20261126-0048-evaluation.md) |
| F02 Gestão de eventos e vitrine | Claude Code (claude-opus-5-5) | Codex CLI (gpt-6) | [relatório](docs/features/F02-events/reports/20261126-0113-evaluation.md) |
| F03 Compra e gateway simulado | Claude Code (claude-opus-5-5) | Codex CLI (gpt-6) | [relatório](docs/features/F03-purchase/reports/20261126-0129-evaluation.md) |
| F04 API de parceiros | Claude Code (claude-opus-5-5) | Codex CLI (gpt-6) | [relatório](docs/features/F04-partner-api/reports/20261126-2053-evaluation.md) |
| F05 Check-in | Codex CLI (gpt-6) | Claude Code (claude-opus-5-5, subagente novo) | [relatório](docs/features/F05-checkin/reports/20261126-2051-evaluation.md) |
| F06 Painel do evento | Claude Code (claude-opus-5-5) | Codex CLI (gpt-6) | [relatório](docs/features/F06-dashboard/reports/20261126-2054-evaluation.md) |
| F07 Cancelamento de evento | Claude Code (claude-opus-5-5) | Codex CLI (gpt-6) | [relatório](docs/features/F07-cancellation/reports/20261126-2128-evaluation.md) |

O PRD foi escrito pelo Claude Code e revisado pelo Codex (comentário no PR #2). As specs, os planos e os
contratos foram escritos pelo Claude Code, e cada contrato foi revisado pelo futuro avaliador antes da
implementação.
