# Plan Tool

The **Plan Tool** produces verifiable, idempotent plans for multi-step changes.

## Goals
- Deterministic, replayable plans with clear inputs/outputs.
- Bounded steps, timeouts, and explicit approval gates.
- Artifacts written to `.plans/<id>/{plan.json, plan.md}`.

## API
- `POST /plan` (existing) accepts: `{ goal, inputs, constraints }`.
- Returns `{ planId, steps[], approvals[] }` and streams progress over SSE.

## Steps Schema
```json
{
  "id": "s1",
  "action": "apply_changes|run_tests|open_pr|index_repo|...",
  "capability": "repo.read|repo.write|test.run|network.egress",
  "timeout_s": 600,
  "approval": false,
  "inputs": {},
  "outputs": {}
}
```

## Acceptance
- All steps succeed or plan fails with actionable diagnostics.
- PR created with diffs and tests; docs updated; traces collected.
