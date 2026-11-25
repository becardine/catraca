# Contract — <ID> <Feature name>

The agreement between implementer and evaluator. The evaluator exercises **only** what is written here,
against a given commit, from a clean environment.

## Prerequisites

- Commit under evaluation checked out, `npm run down -- --reset && npm run up` succeeded.
- Variables: `WEB=http://localhost:3000`, `API=http://localhost:3000`, `KEY=<partner key from README>`.
- Accounts: seed users from `README.md`.
- Any extra setup (data to create first) is listed per item.

## Items

Each item is verifiable by a command or an observable effect, and states the expected result exactly.

### <ID>-C1 — <short title>

- **Steps**:
  ```sh
  curl -s -i -H "X-Api-Key: $KEY" "$API/api/partner/events"
  ```
- **Expected**: HTTP 200; body is a JSON array; ...

### <ID>-C2 — ...

### <ID>-C-GATES — Gates pass

- **Steps**: `npm run gates`
- **Expected**: exit code 0, summary shows all PASS.

## Criteria mapping

Every PRD criterion of this feature (and each cross-feature criterion assigned to it) maps to ≥ 1 item.

| PRD criterion | Rules | Contract items |
|---|---|---|
| <ID>-AC1 | R.. | <ID>-C1 |
| X-<A>-<B>-1 (cross-feature) | R.. | <ID>-C2 |
