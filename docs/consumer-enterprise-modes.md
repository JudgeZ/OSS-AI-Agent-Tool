# Consumer vs Enterprise Modes

This app runs in **consumer** (single-user, local-first) and **enterprise** (multi-tenant, centralized) modes.

## Consumer
- **Runtime**: Tauri desktop + local services via Docker Compose.
- **Auth**: API keys (stored locally) and OAuth for providers that support consumer OAuth (e.g., Google, OpenRouter).
- **Messaging**: default **RabbitMQ** (lightweight). Kafka optional.
- **Secrets**: encrypted local keystore (OS keychain or file-based with passphrase).
- **Queue adapter knobs**: provide RabbitMQ URL via `RABBITMQ_URL` (default `amqp://guest:guest@localhost:5672`); tune prefetch with `RABBITMQ_PREFETCH`; control retry backoff with `RABBITMQ_RETRY_DELAY_MS`.

## Enterprise
- **Runtime**: Kubernetes with Helm; multi-tenant orchestrator.
- **Auth**: OIDC (SSO for users), OAuth/OIDC or provider-native auth for model providers.
- **Messaging**: **Kafka** (preferred) or RabbitMQ based on org standards.
- **Secrets**: cloud secret manager or Vault; **CMEK** per tenant; audit logging + OTel traces.
- **Compliance**: DPIA, data retention, system cards, SBOMs, signed releases.
- **Queue adapter knobs**: wire RabbitMQ through `RABBITMQ_URL` or point to Kafka adapter (future); prefetch and retry delay env vars tune worker concurrency/latency; completions must post to `plan.completions` queue with same idempotency key.

## Switching modes
Set `RUN_MODE=consumer|enterprise`. Behavior differences:
- Secrets backend (`LocalFileStore` vs `VaultStore`).
- Messaging implementation injected at runtime.
- OAuth callback host (desktop loopback for consumer; HTTPS domain for enterprise).

## Queue runtime overview

- **Plan submission**: orchestrator publishes each plan step to the `plan.steps` queue with idempotency keys (`<planId>:<stepId>`) to prevent duplicates.
- **Restart resilience**: when the orchestrator restarts, queued tasks are rehydrated into the in-memory registry so completions still carry capability/tool metadata and long-running steps resume execution automatically.
- **Completions**: downstream agents send status updates to the `plan.completions` queue; orchestrator acks, updates SSE history, and tracks dead-letter counts.
- **Metrics**: Prometheus gauge `orchestrator_queue_depth{queue=...}` reflects backlog; counter `orchestrator_queue_retries_total{queue=...}` increments on retries to surface saturation/poison-pill patterns.
- **Dead letters**: failures can be routed to `<queue>.dead` for operator triage; set `x-dead-letter-reason` header to annotate cause.
