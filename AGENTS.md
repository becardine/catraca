# AGENTS.md — Catraca

Entry point for every coding agent (implementer or evaluator). Read this file fully before doing anything.

Catraca sells tickets for small events (bar gigs, workshops, meetups). The product brief lives in
`docs/brief.md`; business rules are numbered **R01–R13** and everything traces back to them.

## Commands

| Purpose | Command | Notes |
|---|---|---|
| Start everything | `npm run up` | Builds and starts Postgres + app via Docker Compose. Migrations and seed run on every start. No other step needed on a clean clone. |
| Stop everything | `npm run down` | Removes all containers/networks started by `up` and `gates`. Keeps data. `npm run down -- --reset` also drops the DB volume. |
| Quality gates | `npm run gates` | lint (Biome) → typecheck (tsc) → build → tests (Vitest) against an **isolated**, throwaway Postgres (`docker-compose.gates.yml`, port 55433). Must pass before any feature is marked done. |
| Auto-fix formatting | `npm run format` | |

Addresses after `npm run up`: **WEB** `http://localhost:3000`, **API** `http://localhost:3000/api/partner`.
Seed credentials and the partner API key are in `README.md` and `src/db/seed.ts`.

Prerequisites: Docker, Node.js LTS (≥ 20), Git. No real payment key is ever needed.

## Language rules

- **English**: all code, identifiers, file/folder names, commit messages, branch names, PR titles,
  and every document written for agents (this file, PRD, specs, plans, contracts, evaluation reports, state file).
- **Portuguese (pt-BR)**: documents for humans (`README.md`) and **every user-facing string in the UI**.
- UI strings mandated by the brief must match **exactly**, character by character:
  - `Ingressos esgotados`
  - Check-in: `Ingresso inválido para este evento`, `Evento cancelado`, `Ingresso não confirmado`,
    `Ingresso já utilizado`, `Entrada liberada`
  - Status labels: pendente, confirmado, recusado, cancelado, estornado
- Partner API values are fixed English strings (`pending`, `confirmed`, `declined`, `cancelled`,
  `refunded`, `unauthorized`, `invalid_request`, `event_not_available`, `sold_out`, `ticket_not_found`).

## Stack (fixed — do not introduce alternatives)

- Node.js 22 + TypeScript (ESM, `NodeNext`; relative imports end in `.js`).
- Fastify for HTTP (UI + partner API in the same server). UI is server-rendered HTML; no SPA.
- PostgreSQL 16 via `pg` with plain SQL. Schema changes = new file `migrations/NNN_description.sql`
  (never edit an applied migration).
- Vitest for tests (`tests/**/*.test.ts`), Biome for lint/format.
- IDs are prefixed strings from `src/lib/ids.ts` (`usr_`, `evt_`, `tkt_`).
- Money is integer cents (`price_cents`). Never floats.

## Project rules (cross-feature invariants)

These are the rules that broke the first attempt. Every feature must respect them.

1. **Seats (R05/R07)**: occupied seats = `pending` + `confirmed` tickets. A purchase checks and inserts
   inside one transaction that locks the event row (`SELECT ... FOR UPDATE`). Occupied seats must never
   exceed capacity, even under concurrent requests. Cancelled events have 0 available seats.
2. **Gateway (R06/R08/R11)**: purchase responds immediately with `pending`; the simulated gateway resolves
   later through a persisted job (no in-memory-only timers). Applying a gateway result is a conditional
   update (`... WHERE status = 'pending'`), so a late response never changes a cancelled/refunded ticket.
3. **Price snapshot (R03/R12)**: each ticket stores the price paid at purchase time. Revenue = sum of
   that column over `confirmed` tickets. Never use the event's current price for past tickets.
4. **Single source of truth**: dashboard numbers are computed from tickets, never from separate counters.
5. **Channels are equal**: storefront and partner API purchases go through the same domain function and
   count the same for capacity, dashboard, check-in and cancellation.
6. **Ownership (R13)**: every organizer query filters by the logged-in organizer. Another organizer's
   event must look like it does not exist (no data leak, not even the name).
7. **Simulated gateway timings** follow the brief exactly when `GATEWAY_DELAY_SCALE=1` (default).
   Tests may lower the scale; never change the default.

## Workflow (Spec-Driven Development)

For each feature, in wave order from the PRD:

1. **Spec** (`spec.md`) → **Plan** (`plan.md`) → **Contract** (`contract.md`), all written **before** code.
2. **Implement** on branch `feat/<ID>-<slug>` (worktree for parallel waves). Small commits,
   Conventional Commits (`feat(F03): ...`). Run `npm run gates` before handing off.
3. **Evaluate** with a **separate agent** (new session or fresh subagent with empty context) that did not
   implement the feature. It receives only: this file, the contract, and the commit SHA.
4. The evaluator writes a **new** report `docs/features/<ID>-<slug>/reports/<YYYYMMDD-HHMM>-evaluation.md`
   from `docs/templates/evaluation-report.md`. **Reports are immutable**: never edit a committed report;
   a re-evaluation creates a new file.
5. Any failed item → fix → new evaluation, until the latest report passes every contract item.
6. Update `project-state.json` (status + path of the latest report) in the same PR.

Implementers never write or edit evaluation reports. Evaluators never edit product code.

### Attribution (who did what)

Two agent tools are used on this project (Claude Code and Codex). Every artifact must say which one produced it.

- **Commits**: every commit made by an agent ends with these trailers (after a blank line), with the
  tool and the exact model in use:
  ```
  Agent-Tool: claude-code | codex
  Agent-Model: <model id, e.g. claude-opus-5-5>
  Agent-Role: implementer | evaluator | author
  ```
  `author` = PRD/spec/plan/contract/docs work. Commits made by the human have no trailers.
  Right after them, add the tool's GitHub co-author line (it renders the tool's avatar on GitHub):
  - Claude Code: `Co-Authored-By: Claude <noreply@anthropic.com>`
  - Codex: `Co-authored-by: Codex <noreply@openai.com>`

  Full example (Codex implementing):
  ```
  test: cover ID and token generation

  Agent-Tool: codex
  Agent-Model: gpt-6
  Agent-Role: implementer
  Co-authored-by: Codex <noreply@openai.com>
  ```
  The `Agent-*` trailers are the source of truth for attribution; the co-author line is a visual aid.
  List them with: `git log --format='%h %s | %(trailers:key=Agent-Tool,valueonly,separator=%x2C)'`
- **Evaluation reports**: fill `Implemented by` (tool + model of the implementation commits) and the
  evaluator's own `Tool` / `Model`. The evaluator should be a different tool than the implementer
  whenever possible; it must always be a different session with empty context.
- **`project-state.json`**: each feature records `implementedBy` and `evaluatedBy` (see format below).
- **PR description**: states the implementing tool + model and links the latest evaluation report.

### Pull requests and merging

- The **implementer opens the PR** with `gh pr create` from its branch to `main`. Title in
  Conventional Commits style (e.g. `feat(F03): storefront purchase`). Description: what changed,
  implementing tool + model, gates result, link to the latest evaluation report (or "pending evaluation").
- **Agents never merge** PRs (no `gh pr merge`, no push to `main`). **The human merges** after the
  latest evaluation report approves every contract item.
- The **evaluator never opens or merges PRs**; it only commits its report (see Workflow step 4).
- Do not push unless the task asks for it (`git push -u origin <branch>` is part of opening a PR).

### `project-state.json` feature format

```json
{
  "id": "F03",
  "name": "Storefront purchase and simulated gateway",
  "wave": 3,
  "status": "planned | specified | in_progress | in_evaluation | needs_fix | done",
  "dir": "docs/features/F03-purchase",
  "branch": "feat/F03-purchase",
  "pr": "https://github.com/<owner>/<repo>/pull/<n> or null",
  "implementedBy": "claude-code (claude-opus-5-5) or null",
  "evaluatedBy": "codex (ChatGPT app, local, <model>) or null",
  "latestReport": "docs/features/F03-purchase/reports/<YYYYMMDD-HHMM>-evaluation.md or null"
}
```

Update `updatedAt` on every change. `latestReport` must point to an existing file.

### Definition of done (per feature)

- Every PRD criterion of the feature is mapped to at least one contract item.
- `npm run gates` passes on the evaluated commit.
- Latest evaluation report: all items PASS, with evidence.
- `project-state.json` updated; PR merged into `main`.

## Artifact map

| Artifact | Path |
|---|---|
| Product brief (source) | `docs/brief.md` |
| PRD (features, dependencies, waves, acceptance criteria) | `docs/prd.md` |
| Per-feature spec / plan / contract | `docs/features/<ID>-<slug>/{spec,plan,contract}.md` |
| Evaluation reports | `docs/features/<ID>-<slug>/reports/*.md` |
| Templates | `docs/templates/` |
| Project state (status per feature) | `project-state.json` |
| Harness scripts | `scripts/up.mjs`, `scripts/down.mjs`, `scripts/gates.mjs` |
| Migrations / seed | `migrations/`, `src/db/seed.ts` |
| Human docs (pt-BR) | `README.md` |

## Code layout

```
src/
  main.ts        boot: migrate → seed → listen
  app.ts         buildApp(): Fastify instance, routes registered per feature module
  config.ts      env config (PORT, DATABASE_URL, PARTNER_API_KEY, GATEWAY_DELAY_SCALE)
  db/            pool, migration runner, seed
  lib/           shared helpers (ids, password)
  <module>/      one folder per domain module (e.g. events/, tickets/, partner-api/)
migrations/      NNN_*.sql
tests/           *.test.ts (use tests/helpers/db.ts; run through `npm run gates`)
scripts/         harness (Node built-ins only)
```
