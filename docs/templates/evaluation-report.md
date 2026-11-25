# Evaluation report — <ID> <Feature name>

> Immutable: never edit after commit. A re-evaluation is a new file.

- **Date**: <YYYY-MM-DD HH:MM (timezone)>
- **Evaluated commit**: `<full SHA>` (branch `<branch>` or `main`)
- **Implemented by**: <tool + model from the implementation commits' Agent-Tool/Agent-Model trailers>
- **Tool (evaluator)**: <e.g. Codex — ChatGPT app, local mode / Claude Code — fresh session>
- **Model (evaluator)**: <exact model shown by the tool>
- **Evaluator independence**: <how context was isolated from the implementer>
- **Contract**: `docs/features/<ID>-<slug>/contract.md` at the evaluated commit
- **Previous report**: <path or "none">

## Summary

| Item | Verdict |
|---|---|
| <ID>-C1 | PASS / FAIL |

**Overall verdict**: APPROVED (all PASS) / REJECTED (n FAIL)

## Evidence

### <ID>-C1 — <title> — PASS/FAIL

Command:
```sh
...
```
Output:
```
...
```
Notes: why this proves (or fails) the expected result.

## Failures to fix

For each FAIL: what was expected, what happened, minimal reproduction.
