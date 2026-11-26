# Spec — F01 Accounts and access

- **Feature ID**: F01
- **Wave**: 1
- **PRD criteria covered**: F01-AC1 … F01-AC5
- **Cross-feature criteria assigned here**: none (X-F01-F02-1 and X-F01-F03-1 belong to F02/F03 contracts)
- **Rules**: R13

## Goal

Participants can sign up, log in and log out. Organizers (seed only) can log in. Every route under
`/organizer` is protected by construction, so later features cannot forget the access check.

## Provides (to other features)

| Item | Kind | Signature / shape |
|---|---|---|
| `request.user` | Fastify request decoration | `{ id, name, email, role: "organizer" \| "participant" } \| null`, filled on every request from the session cookie |
| `requireUser`, `requireParticipant`, `requireOrganizer` | preHandlers (`src/auth/guards.ts`) | no user → `303 Location: /login`; wrong role → `403` page `Acesso negado` |
| `registerOrganizerRoutes(app, (scope) => { … })` | helper (`src/auth/organizer-area.ts`) | registers routes under `/organizer` in an encapsulated plugin whose `onRequest` hook runs `requireOrganizer`; also guards the `/organizer/*` 404 handler |
| `renderPage({ title, body, user, status? })` | UI shell (`src/ui/layout.ts`) | full HTML document with nav: Vitrine (`/`), Meus ingressos (participant), Área do organizador (organizer), Entrar/Criar conta or Sair |
| `html` / `escapeHtml` | helpers (`src/ui/html.ts`) | tagged template that escapes interpolations; `raw()` to opt out |
| `sendPage(reply, page, status)` | helper | sets `content-type: text/html; charset=utf-8` |
| `sessions` table | migration `002_sessions.sql` | `id` (sha256 of token), `user_id`, `created_at`, `expires_at` |

## Consumes (from other features)

| Item | From | How it is used |
|---|---|---|
| `users` table, seed users | harness | login and signup |
| `hashPassword`, `verifyPassword`, `randomToken` | harness (`src/lib`) | credentials and session tokens |

## Data model

`migrations/002_sessions.sql`:

```sql
CREATE TABLE sessions (
  id          text PRIMARY KEY,           -- sha256(token) hex; the raw token lives only in the cookie
  user_id     text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL
);
CREATE INDEX sessions_user_id_idx ON sessions(user_id);
```

## Routes / pages

| Method | Path | Who | Behavior | Responses |
|---|---|---|---|---|
| GET | `/signup` | anyone | signup form (Nome, E-mail, Senha) | 200 |
| POST | `/signup` | anyone | validate; create `participant`; start session | 303 → `/`; 422 form with message |
| GET | `/login` | anyone | login form | 200 |
| POST | `/login` | anyone | verify; start session | 303 → `/organizer/events` (organizer) or `/` (participant); 401 form with `E-mail ou senha inválidos` |
| POST | `/logout` | anyone | delete session row, clear cookie | 303 → `/` |
| GET | `/` | anyone | placeholder home (F02 replaces it with the storefront) showing `Olá, <name>` when logged in | 200 |
| GET | `/organizer/events` | organizer | placeholder organizer home (F02 replaces the content) | 200 / 303 / 403 |

Validation messages (pt-BR, shown in the form):
- `Informe o nome.` · `Informe um e-mail válido.` · `A senha deve ter pelo menos 6 caracteres.` · `Este e-mail já está cadastrado.`

## Technical decisions

- **Server-side sessions in Postgres** with a random 32-char token in an httpOnly, `SameSite=Lax`, `Path=/`
  cookie named `catraca_session` (7-day expiry). Only `sha256(token)` is stored, so a DB dump does not leak
  sessions. *Rejected*: signed JWT cookie, because logout would not invalidate it server-side (F01-AC3).
- **`SameSite=Lax`** blocks cross-site POSTs (basic CSRF protection) without a token framework. *Rejected*:
  CSRF tokens, out of MVP scope.
- **Guarding by construction**: organizer routes are only registered through `registerOrganizerRoutes`, whose
  hook runs before any handler, including unknown `/organizer/*` paths. *Rejected*: per-route preHandlers,
  because a later feature could forget one (R13).
- **Signup never reads a role**: the insert hard-codes `participant`. Organizer creation is out of scope.
- **E-mail normalization**: trimmed and lowercased before validation and lookup (DB has `CHECK email = lower(email)`).
- **Templates**: TypeScript tagged templates with automatic escaping. *Rejected*: a template engine, an extra
  dependency for a handful of pages.
- Plugins: `@fastify/cookie`, `@fastify/formbody` (`application/x-www-form-urlencoded` forms).

## Edge cases and invariants

- Expired or unknown session token → treated as visitor (and the stale row is ignored).
- Login with an unknown e-mail and with a wrong password give the same message and status (no account enumeration).
- Signup with an e-mail already used, in any letter case, is rejected.
- Failed signup or login never sets a session cookie.
- Logout deletes the session row: replaying the old cookie behaves as visitor.
- AGENTS.md rule 6 (ownership) starts here: `request.user.id` is the only source of the current organizer.

## Out of scope

Password recovery, profile editing, organizer signup, "remember me", rate limiting, CSRF tokens.
