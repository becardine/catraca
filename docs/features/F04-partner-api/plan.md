# Plan — F04 Partner API

1. `src/partner-api/auth.ts`: `requirePartnerKey(config)` hook (constant-time compare).
2. `src/partner-api/validation.ts`: `parsePurchaseBody(body)` → `{ buyerEmail, cardNumber } | null`.
3. `src/partner-api/routes.ts`: scope `/api/partner` with the key hook, 422 mapping of body-parse errors,
   JSON 404; the three routes; `src/partner-api/index.ts` `registerPartnerApi(app, deps)`; one line in `src/app.ts`.
4. Tests `tests/partner-api.test.ts` (inject): auth on all routes and unknown paths, listing fields and
   filtering (draft, cancelled), error order matrix, 202 shape, ticket lookup from both channels, no account link,
   30×5 burst on 2 fresh events through HTTP.

Integration: `src/app.ts` is also edited by F05/F06 in this wave; keep the change to one import + one line.
