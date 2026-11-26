# Contract — F01 Accounts and access

The evaluator exercises **only** what is written here, against the given commit, from a clean environment.

## Prerequisites

- Commit under evaluation checked out; `npm run down -- --reset && npm run up` succeeded.
- Shell: bash (on Windows use Git Bash). `WEB=http://localhost:3000`.
- Seed accounts (README): `org.a@catraca.test`, `org.b@catraca.test`, `participante@catraca.test`, password `catraca123`.
- DB queries: `docker compose exec -T db psql -U catraca -tAc "<sql>"`.
- Use a fresh e-mail per run, e.g. `NEW=f01-$(date +%s)@example.com`.

## Items

### F01-C1 — Signup creates a logged-in participant

- **Steps**:
  ```sh
  curl -s -i -c jar1 -X POST "$WEB/signup" --data-urlencode "name=Nova Pessoa" \
    --data-urlencode "email=$NEW" --data-urlencode "password=segredo1"
  curl -s -b jar1 "$WEB/"
  docker compose exec -T db psql -U catraca -tAc "select role from users where email='$NEW'"
  ```
- **Expected**: first response `303` with `Location: /` and a `Set-Cookie` header whose cookie
  `catraca_session` has a non-empty value and the attributes `HttpOnly`, `SameSite=Lax`, `Path=/` and
  `Max-Age=604800` (7 days), in any order; the home page contains `Nova Pessoa`; the query returns `participant`.

### F01-C2 — Invalid signups are rejected and create nothing

- **Steps**: count users (`select count(*) from users`), then POST `/signup` (all other fields valid, fresh
  e-mail) with, one at a time:
  (a) `name` omitted, (b) `name=` empty, (c) `email` omitted, (d) `email=not-an-email`,
  (e) `password` omitted, (f) `password=123`, (g) the e-mail from C1 in upper case.
- **Expected**: each answers `422`, has no `Set-Cookie: catraca_session`, and shows:
  (a, b) `Informe o nome.`; (c, d) `Informe um e-mail válido.`; (e, f) `A senha deve ter pelo menos 6 caracteres.`;
  (g) `Este e-mail já está cadastrado.`. The user count is unchanged after all seven.

### F01-C3 — Signup cannot create an organizer

- **Steps**: POST `/signup` with a new e-mail and an extra field `role=organizer` (cookie jar `jar3`);
  query its role; `curl -s -o /dev/null -w "%{http_code}" -b jar3 "$WEB/organizer/events"`.
- **Expected**: role is `participant`; organizer area answers `403`.

### F01-C4 — Seed accounts log in

- **Steps**: for each seed account: `curl -s -i -c jarX -X POST "$WEB/login" --data-urlencode email=… --data-urlencode password=catraca123`, then `curl -s -b jarX "$WEB/"`.
- **Expected**: `303` with a session cookie; `Location: /organizer/events` for org A and org B, `Location: /` for the participant;
  the home page shows the account name (`Organizadora A`, `Organizador B`, `Participante Seed`).

### F01-C5 — Wrong credentials are rejected uniformly

- **Steps**: POST `/login` with `org.a@catraca.test` + `wrongpass`; then with `nobody@example.com` + `catraca123`.
- **Expected**: both `401`, page contains `E-mail ou senha inválidos`, no `Set-Cookie: catraca_session`.

### F01-C6 — Logout ends the session server-side

- **Steps**: log in as org A with `jar6`; copy the cookie file to `jar6-old`; `curl -s -i -b jar6 -c jar6 -X POST "$WEB/logout"`;
  then `curl -s -i -b jar6-old "$WEB/organizer/events"`; then, with `T` = the raw `catraca_session` value
  from `jar6-old`:
  `docker compose exec -T db psql -U catraca -tAc "select count(*) from sessions where id = encode(sha256('$T'::bytea), 'hex')"`.
- **Expected**: logout answers `303` `Location: /` and expires the cookie; replaying the **old** cookie gets
  `303` `Location: /login`; the query returns `0` (the session row was deleted, not only the cookie).

### F01-C7 — Organizer area is closed to visitors and participants

- **Steps**: `curl -s -i "$WEB/organizer/events"`; `curl -s -i "$WEB/organizer/anything/else"`;
  same two URLs with the seed participant's cookie; `GET /organizer/events` with org A's cookie.
- **Expected**: visitor → `303` `Location: /login` on both; participant → `403` with `Acesso negado` on both;
  organizer → `200`.

### F01-C8 — No plain-text secrets in the database

- **Steps** (`T` = raw `catraca_session` value from `jar1`, i.e. a session still logged in):
  ```sh
  docker compose exec -T db psql -U catraca -tAc "select email, password_hash from users where email in ('$NEW','org.a@catraca.test','org.b@catraca.test','participante@catraca.test')"
  docker compose exec -T db psql -U catraca -tAc "select count(*) from sessions where id = '$T'"
  docker compose exec -T db psql -U catraca -tAc "select count(*) from sessions where id = encode(sha256('$T'::bytea), 'hex')"
  ```
- **Expected**: all four hashes start with `scrypt:` and none contains `segredo1` or `catraca123`; the
  raw-token query returns `0` and the sha256 query returns `1` (the session is stored only as sha256 of the token).

### F01-C-GATES — Gates pass

- **Steps**: `npm run gates`
- **Expected**: exit code 0; summary all PASS; the test files for F01 (`ui`, `sessions`, `guards`, `auth`) ran.

## Criteria mapping

| PRD criterion | Rules | Contract items |
|---|---|---|
| F01-AC1 | — | F01-C1, F01-C2 |
| F01-AC2 | — | F01-C4, F01-C5 |
| F01-AC3 | — | F01-C6 |
| F01-AC4 | R13 | F01-C3, F01-C7 |
| F01-AC5 | — | F01-C8 |
| all | — | F01-C-GATES |

Cross-feature criteria assigned to F01: none (see PRD §5).
