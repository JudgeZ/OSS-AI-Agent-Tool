# Plan Tool

The **Plan Tool** produces verifiable, idempotent plans for multi-step changes and exposes them through the orchestrator HTTP API.

## Goals
- Deterministic, replayable plans with clear inputs/outputs.
- Bounded steps, timeouts, and explicit approval gates.
- Artifacts written to `.plans/<id>/{plan.json, plan.md}`.
- Stream step lifecycle events over Server-Sent Events (SSE) for UI updates.

## HTTP API

### `POST /plan`

Request body:

```json
{
  "goal": "Ship the next milestone"
}
```

Response body:

```json
{
  "plan": {
    "id": "plan-a1b2c3d4",
    "goal": "Ship the next milestone",
    "steps": [
      {
        "id": "s1",
        "action": "index_repo",
        "tool": "repo_indexer",
        "capability": "repo.read",
        "capabilityLabel": "Read repository",
        "labels": ["repo", "automation"],
        "timeoutSeconds": 300,
        "approvalRequired": false
      },
      {
        "id": "s2",
        "action": "apply_changes",
        "tool": "code_writer",
        "capability": "repo.write",
        "capabilityLabel": "Apply repository changes",
        "labels": ["repo", "automation", "approval"],
        "timeoutSeconds": 900,
        "approvalRequired": true
      }
    ],
    "successCriteria": ["All tests pass", "CI green", "Docs updated"]
  },
  "traceId": "07f1d186-4f07-4b40-9265-6a51f78fbdfa"
}
```

Each plan creation emits a `plan.step` event per step in the `queued` state (see below). Artifacts are written to `.plans/<id>/plan.json` and `.plans/<id>/plan.md` as part of the same request.

### `POST /chat`

Thin pass-through to the model provider registry. Example payload:

```json
{
  "messages": [
    { "role": "user", "content": "Summarize the diff." }
  ]
}
```

Successful responses include the provider response and a `traceId` that correlates with the plan and chat spans.

### `GET /plan/:id/events`

An SSE endpoint that replays existing events and streams subsequent step transitions in real-time. Clients should set `Accept: text/event-stream`.

Sample event payload:

```text
event: plan.step
data: {"event":"plan.step","traceId":"07f1d186-4f07-4b40-9265-6a51f78fbdfa","planId":"plan-a1b2c3d4","step":{"id":"s2","action":"apply_changes","tool":"code_writer","state":"queued","capability":"repo.write","capabilityLabel":"Apply repository changes","labels":["repo","automation","approval"],"timeoutSeconds":900,"approvalRequired":true}}
```

For test automation or scripting scenarios, sending `Accept: application/json` returns a JSON object with the accumulated events instead of holding the connection open.

## Step Metadata

Each step surfaces the capability it exercises, the execution timeout, and whether human approval is required:

```json
{
  "id": "s2",
  "action": "apply_changes",
  "tool": "code_writer",
  "capability": "repo.write",
  "capabilityLabel": "Apply repository changes",
  "labels": ["repo", "automation", "approval"],
  "timeoutSeconds": 900,
  "approvalRequired": true
}
```

## Observability

Every HTTP handler and plan creation call is wrapped in a lightweight tracing shim that records a `traceId`, span attributes (plan id, chat model, etc.), and structured log entries. The implementation is intentionally minimal so OpenTelemetry exporters can be layered in without changing call sites.

## Durable orchestration

The orchestrator persists outstanding plan steps to a password-protected local keystore (`PlanResumeStore`) so long-running tool invocations can survive process restarts or crash recovery. When a plan step is enqueued the runtime stores the full `PlanStep` payload and marks it `queued`. As soon as the queue consumer begins executing the tool agent the state flips to `running`. On acknowledgement—success, failure, or dead-letter—the entry is marked `completed` and eventually evicted.

During bootstrap `initializePlanQueueRuntime()` hydrates the store, repopulates the in-memory step registry, and replays any `running` steps back to RabbitMQ with the original idempotency key. That ensures in-flight work is retried automatically while still deduplicating completed steps. The resume store defaults to `./.runtime/plan-runtime-state.json` but can be relocated with `PLAN_RUNTIME_STORE_PATH`.
