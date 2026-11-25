# Spec — <ID> <Feature name>

- **Feature ID**: <ID>
- **Wave**: <n>
- **PRD criteria covered**: <ID>-AC1, <ID>-AC2, ... (and cross-feature X-...)
- **Rules**: R..

## Goal

One paragraph: what this feature delivers and for whom.

## Provides (to other features)

| Item | Kind (function / route / table / page) | Signature / shape |
|---|---|---|

## Consumes (from other features)

| Item | From feature | How it is used |
|---|---|---|

## Data model

Tables/columns added or changed (new migration file name).

## Routes / pages

| Method | Path | Who | Behavior | Responses |
|---|---|---|---|---|

## Technical decisions

Each decision with the alternative considered and why it was rejected.

## Edge cases and invariants

Explicit list. Reference the project rules in `AGENTS.md` that apply.

## Out of scope

What this feature deliberately does not do.
