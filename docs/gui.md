# GUI timeline and approval flow

The desktop GUI (`apps/gui`) packages a SvelteKit frontend with a Tauri shell. It renders real-time plan execution coming from the orchestrator's Server-Sent Events (SSE) stream and provides the approval workflow required for privileged capabilities such as `repo.write` and `network.egress`.

## Prerequisites

* Node.js 18+
* Rust toolchain (for the Tauri host)
* `npm` or `pnpm`

## Local development

```bash
cd apps/gui
npm install
npm run dev
```

By default the UI connects to `http://127.0.0.1:3001`. Override the orchestrator base URL when launching the dev server:

```bash
VITE_ORCHESTRATOR_URL=http://localhost:4010 npm run dev
```

The timeline page accepts a `plan` query parameter to start streaming immediately:

```
http://localhost:5173/?plan=plan-1234
```

### Tauri shell

Use the bundled commands to develop or package the desktop shell:

```bash
npm run tauri        # launches SvelteKit and embeds it in Tauri
npm run tauri:build  # produces distributable binaries
```

## SSE timeline

The frontend listens for `plan.step` events emitted by the orchestrator at `/plans/:planId/stream`. Every event updates the timeline, appending the latest status transition and highlighting the associated capability badge. Connection state is surfaced at the top of the page so operators can quickly validate the stream health.

## Approval UX

When a step enters the `waiting_approval` state and advertises a privileged capability (for example `repo.write`), the UI raises a modal dialog that blocks interaction with the rest of the application. Operators must explicitly choose **Approve** or **Reject**. The modal submits the decision to the orchestrator endpoint `/plan/:planId/steps/:stepId/approve` and keeps the overlay until the orchestrator confirms the state transition through SSE. The approval history is preserved in the timeline so the audit trail is immediately visible.

## Smoke tests

Playwright smoke tests exercise the happy-path orchestration run. They spin up a mock SSE orchestrator (`npm run mock:orchestrator`), stream a plan, approve the guarded step, and assert that all status transitions render in the timeline. Run them with:

```bash
npm run test:e2e
```

The mock orchestrator and tests live under `apps/gui/tests/` and can be extended to cover additional scenarios (rejections, error states, etc.).
