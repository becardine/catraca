# Catraca

Venda de ingressos para eventos pequenos (shows em bar, workshops, meetups), construída em modo agente
com Spec-Driven Development: PRD → spec, plano e contrato por feature → implementação por agente →
avaliação por um agente independente.

> Status: harness pronto, PRD em revisão, features a implementar (veja `project-state.json`).

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
roda os testes num Postgres isolado, sem mexer nos dados do ambiente que está de pé.

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

A seed roda a cada subida e é idempotente.

## Mapa dos artefatos

| Artefato | Onde |
|---|---|
| Brief original | [`docs/brief.md`](docs/brief.md) |
| PRD (7 features, grafo, waves, critérios) | [`docs/prd.md`](docs/prd.md) |
| Pasta de cada feature (spec, plano, contrato e relatórios) | `docs/features/<ID>-<slug>/` |
| Templates | [`docs/templates/`](docs/templates/) |
| Arquivo de estado | [`project-state.json`](project-state.json) |
| Porta de entrada dos agentes | [`AGENTS.md`](AGENTS.md) (o [`CLAUDE.md`](CLAUDE.md) aponta para ele) |
| PRs da wave paralela | *(a preencher)* |

## Decisões

- **Stack:** Node.js 22 + TypeScript, Fastify, PostgreSQL 16 e Docker Compose. O Node já está na máquina
  do avaliador. O Postgres oferece transações e lock de linha, que resolvem a lotação sob concorrência
  sem infraestrutura extra. Usamos um único servidor para a interface (HTML renderizado no servidor) e
  para a API, porque menos peças significam menos pontos de falha entre as features.
- **R07 sob concorrência:** *(a documentar na feature de compra; plano: transação com
  `SELECT ... FOR UPDATE` na linha do evento antes de contar vagas e inserir o ingresso, comprovada por
  teste automatizado de rajada nos gates)*.
- **Resposta assíncrona do gateway:** *(a documentar; plano: job persistido no banco com horário de
  resposta, processado por um worker; a aplicação do resultado só altera ingresso ainda `pending`)*.
- **Isolamento da avaliação:** cada avaliação roda numa sessão nova, com contexto vazio, que recebe só o
  `AGENTS.md`, o contrato e o commit, e grava um relatório novo e imutável. Sempre que possível, quem
  avalia é a outra ferramenta: o Codex avalia o que o Claude Code implementou e vice-versa.

### Quem fez o quê

Usamos duas ferramentas: Claude Code e Codex (app do ChatGPT, modo local). Cada commit de agente traz os
trailers `Agent-Tool`, `Agent-Model` e `Agent-Role`, e cada relatório registra quem implementou e quem
avaliou. Para listar os commits por ferramenta:

```sh
git log --format='%h %s | %(trailers:key=Agent-Tool,valueonly,separator=%x2C)'
```

| Feature | Implementado por | Avaliado por | Relatório mais recente |
|---|---|---|---|
| Harness | Claude Code (claude-opus-5-5) | — | — |
| F01 Contas e acesso | Claude Code (claude-opus-5-5) | Codex CLI (gpt-6) | [relatório](docs/features/F01-accounts/reports/20261126-0048-evaluation.md) |
| F02 Gestão de eventos e vitrine | Claude Code (claude-opus-5-5) | Codex CLI (gpt-6) | [relatório](docs/features/F02-events/reports/20261126-0113-evaluation.md) |
| F03 Compra e gateway simulado | Claude Code (claude-opus-5-5) | Codex CLI (gpt-6) | [relatório](docs/features/F03-purchase/reports/20261126-0129-evaluation.md) |
| F06 Painel do evento | Claude Code (claude-opus-5-5) | Codex CLI (gpt-6) | [relatório](docs/features/F06-dashboard/reports/20261126-2054-evaluation.md) |
| *(features do PRD, a preencher)* | | | |
