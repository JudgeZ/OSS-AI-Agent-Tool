# Components

- **Gateway API (Go)** — SSE fanout, OAuth redirects, auth enforcement, tracing headers.
- **Orchestrator (TS)** — Workflow engine, plan tool, provider routing, policy checks.
- **Indexer (Rust)** — Symbolic (LSP/tree-sitter), semantic embeddings, temporal diffs.
- **Memory Svc** — Redis (working/episodic) + Postgres (history/audit).
- **Providers** — Pluggable ModelProvider implementations (remote & local).
- **Message Bus** — RabbitMQ or Kafka for long-running or parallelizable work.
- **Observability** — OpenTelemetry collector → Jaeger; Langfuse (optional) for lineage.
