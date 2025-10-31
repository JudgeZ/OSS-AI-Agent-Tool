# Remediation Plan: Platform Reliability, Config, and Documentation Alignment

## Overview
This remediation plan addresses the current gaps called out across the CLI build pipeline, configuration handling, documentation accuracy, messaging infrastructure, and orchestrator runtime guarantees. The scope prioritises restoring broken flows (CLI planner build, configuration error surfacing, Docker developer experience) before layering in new runtime defaults (enterprise run mode, Kafka adapter) and documentation truthfulness.

## Objectives
1. Restore functional CLI planner builds and guarantee CI coverage.
2. Surface configuration failures and align configuration overrides with documentation.
3. Synchronize Docker, configuration, and provider documentation with actual runtime behaviour.
4. Enable secure defaults for SecretsStore usage and enterprise run-mode settings.
5. Deliver Kafka messaging support and accurate event sequencing.
6. Harden queue state transitions and OAuth token retrieval under failure modes.

## Milestones & Timeline
- **Wave 1 (Week 1)** – CLI build unblock, configuration error visibility, Docker quickstart/doc updates, SecretsStore bootstrap, docs alignment for configuration tables.
- **Wave 2 (Weeks 2-3)** – Run-mode driven defaults, Kafka adapter implementation, queue state atomicity, planner approval event adjustments, OAuth timeout handling, policy documentation status update.
- **Wave 3 (Week 4)** – Comprehensive documentation refresh, provider capability alignment, expanded integration/unit coverage, CI automation finalisation.

## Detailed Remediation Tasks

### 1. Unblock CLI Builds
- **Task 1.1:** Export planner functionality via compiled module (e.g., re-export planner entry point from `services/orchestrator/dist` or ship shim under `services/orchestrator/dist`).
- **Task 1.2:** Update `apps/cli` to import the compiled artifact or embed a minimal planner helper so esbuild resolves correctly.
- **Task 1.3:** Add `npm run build` for `apps/cli` to CI workflow.
- **Testing & Verification:** Add CLI smoke test covering `aidt plan` execution.

### 2. Surface Configuration Parsing Errors
- **Task 2.1:** Replace silent `catch {}` in `loadConfig` with structured logging/telemetry and optional rethrow.
- **Task 2.2:** Add tests for malformed YAML ensuring diagnostics are surfaced.

### 3. Docker Quickstart Accuracy
- **Task 3.1:** Update Docker quickstart documentation to enumerate all containers started by Compose, clarify auto-start dependencies, and document service commands (Redis/Postgres/RabbitMQ/Kafka/observability).
- **Task 3.2:** Ensure compose file references align with documentation (either adjust docs to match `compose.dev.yaml` or simplify compose stack).

### 4. Configuration Reference Corrections
- **Task 4.1:** Update configuration defaults table to reflect current `loadConfig` behaviour (only OpenAI and Ollama enabled).
- **Task 4.2:** Correct environment variable naming (`MESSAGE_BUS`), document keystore location & passphrase requirement, remove inaccurate runMode promises until implemented.

### 5. Mode Switching Expectations
- **Task 5.1:** Update `docs/consumer-enterprise-modes.md` to communicate that Kafka support is pending and operators must explicitly configure `secrets.backend` and `messaging.type` until defaults are implemented.
- **Task 5.2:** If run-mode defaults are introduced (see Task 9), reinstate documentation language accordingly.

### 6. SecretsStore Developer Experience
- **Task 6.1:** Add `LOCAL_SECRETS_PASSPHRASE` to `compose.dev.yaml` (and `.env` template) with documentation.
- **Task 6.2:** Alternatively or additionally, relax `LocalFileStore` bootstrap to generate a key with a warning when absent.
- **Task 6.3:** Verify OAuth and provider flows succeed in dev stack post-change.

### 7. Align Environment Overrides
- **Task 7.1:** Extend `loadConfig` to honour both `MESSAGE_BUS` and legacy `MESSAGING_TYPE` environment variables, with documented precedence.
- **Task 7.2:** Update unit tests for configuration overrides and sync documentation tables.

### 8. Run-Mode Driven Defaults
- **Task 8.1:** Implement logic in `loadConfig` to swap default `secrets.backend`, `messaging.type`, and OAuth redirect host when `runMode` resolves to enterprise.
- **Task 8.2:** Update tests to cover enterprise defaults and ensure consumer defaults remain unchanged.
- **Task 8.3:** Refresh consumer/enterprise mode documentation to describe new precedence rules.

### 9. Kafka Queue Adapter Implementation
- **Task 9.1:** Build `KafkaAdapter` (using `kafkajs`) that satisfies `QueueAdapter` interface.
- **Task 9.2:** Update `createQueueAdapterFromConfig` to instantiate Kafka adapter when configured.
- **Task 9.3:** Document new configuration keys and dependencies.
- **Task 9.4:** Add integration coverage for `messaging.type: kafka` in CI (docker-compose services for Kafka).

### 10. Respect Explicit Empty Provider Lists
- **Task 10.1:** Allow `asStringArray` to return `[]` when YAML specifies an empty list.
- **Task 10.2:** Ensure environment overrides still take precedence.
- **Task 10.3:** Add regression tests for file-based and environment-based scenarios.

### 11. Queue State Atomicity with Broker Enqueueing
- **Task 11.1:** Emit queued lifecycle events only after enqueue succeeds; roll back state on failure.
- **Task 11.2:** Add error handling around broker calls and extend `PlanQueueRuntime` tests to simulate broker outages.

### 12. OAuth Token Retrieval Hardening
- **Task 12.1:** Wrap OAuth token fetch with `AbortController` and configurable timeout.
- **Task 12.2:** Surface timeout as explicit, actionable errors.
- **Task 12.3:** Add tests simulating slow IdP responses.

### 13. Policy Definition Documentation
- **Task 13.1:** Document actual location/status of policy definitions, pointing to `infra/policies` or clarifying pending state.
- **Task 13.2:** Update references across documentation to align with reality.

### 14. Provider Documentation Alignment
- **Task 14.1:** Remove or flag unsupported features (embeddings, Azure AD auth) from provider docs.
- **Task 14.2:** If features desired, open follow-up issues for embedding endpoints and Azure credential flows.

### 15. Documentation Refresh
- **Task 15.1:** Update `docs/ci-cd.md`, `docs/kubernetes-quickstart.md`, `docs/agents.md`, `docs/configuration.md`, and `docs/consumer-enterprise-modes.md` to cover five workflows, remove absent memory service references, correct directories, rename `MESSAGING_TYPE` to `MESSAGE_BUS`, and state RabbitMQ is currently implemented.

### 16. CLI Planner Command Reliability
- **Task 16.1:** Modify CLI plan command import to reference compiled TypeScript or expose entry point.
- **Task 16.2:** Ensure orchestrator planner is bundled as esbuild dependency.
- **Task 16.3:** Add unit or smoke test verifying `aidt plan` works post-build.

### 17. Plan Event Emission Alignment
- **Task 17.1:** Adjust `createPlan` to withhold `queued` events when approval is required; emit `waiting_approval` (or nothing) until `submitPlanSteps` runs.
- **Task 17.2:** Update event stream tests to ensure consistency with queue state.

## Risk & Mitigation
- **Runtime regressions:** Add unit/integration coverage for configuration and queue logic changes; rely on CI enhancements.
- **Documentation drift:** Assign review owners from Docs & UX to verify technical accuracy prior to merge.
- **Messaging infrastructure complexity:** Stage Kafka adapter rollout behind feature flag until validated in staging.

## Ownership & Dependencies
- **Code Writer:** Tasks 1, 2, 6, 7, 8, 9, 10, 11, 12, 16, 17.
- **Docs & UX Writer:** Tasks 3, 4, 5, 13, 14, 15.
- **Architect:** Validate Kafka adapter design and run-mode defaults alignment.
- **Test Runner:** Expand CI coverage (Tasks 1.3, 2.2, 6.3, 9.4, 11.2, 12.3, 16.3, 17.2).

## Success Criteria
- CLI `npm run build` passes locally and in CI with functional `aidt plan` output.
- Configuration failures emit actionable diagnostics and documentation reflects true env precedence.
- Developers following Docker quickstart achieve working stack without surprises.
- Enterprise run mode automatically selects correct secrets/messaging defaults; Kafka messaging is available and tested.
- Event sequencing matches queue state transitions, and OAuth flows recover gracefully from slow IdPs.
- Documentation across the stack accurately describes behaviour, supported features, and pending gaps.

## Follow-Up Tracking
- Create GitHub issues for each numbered task group with target milestone (Wave assignment).
- Review remediation progress weekly; adjust scope based on regression findings or newly discovered gaps.
- Post-completion, run documentation review and operational readiness check prior to next release.
