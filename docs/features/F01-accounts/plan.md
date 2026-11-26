# Plan — F01 Accounts and access

Spec: `./spec.md` · Contract: `./contract.md`

Each step ends with `npm run gates` passing and is one commit.

## Steps

1. **UI shell and HTML helpers**
   - Files: `src/ui/html.ts`, `src/ui/layout.ts`, `tests/ui.test.ts`
   - Do: `html` tagged template with escaping + `raw()`; `renderPage` with nav by role; `sendPage`.
   - Tests: escaping of `<script>`; nav shows the right links per role.

2. **Sessions**
   - Files: `migrations/002_sessions.sql`, `src/auth/sessions.ts`, `tests/sessions.test.ts`
   - Do: `createSession(pool, userId)` → raw token; `findUserBySession(pool, token)`; `deleteSession(pool, token)`; store sha256.
   - Tests: create/find/delete; expired session returns null; stored id ≠ token.

3. **Auth plugin, guards and organizer area**
   - Files: `src/auth/plugin.ts`, `src/auth/guards.ts`, `src/auth/organizer-area.ts`, `src/app.ts`
   - Do: register cookie + formbody; `onRequest` hook fills `request.user`; guards; `registerOrganizerRoutes` with guarded 404; placeholder `GET /` and `GET /organizer/events`.
   - Tests: `tests/guards.test.ts` — visitor redirected, participant 403, organizer 200, unknown `/organizer/x` guarded.

4. **Signup, login, logout**
   - Files: `src/auth/routes.ts`, `src/auth/accounts.ts`, `tests/auth.test.ts`
   - Do: forms and handlers per spec; validation; uniform login failure.
   - Tests: every contract item that can be automated (signup ok/invalid/duplicate/role ignored, seed logins, wrong password, logout invalidates).

## Integration notes

- `src/app.ts` is shared by every later feature: each feature adds one `register…(app, deps)` line.
- F02 replaces the placeholder handlers of `GET /` and `GET /organizer/events`; keep them in
  `src/ui/placeholders.ts` so F02 can delete that file cleanly.

## Handoff checklist

- [ ] All steps done, `npm run gates` passes
- [ ] Contract prerequisites still accurate
- [ ] `project-state.json` F01 set to `in_evaluation`
- [ ] Commit SHA to evaluate recorded in the PR
