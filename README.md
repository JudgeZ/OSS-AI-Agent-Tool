# OSS AI Agent Tool

Local-first, auditable, multi-agent coding assistant with a desktop GUI.

- **Reliability**: gRPC “inner loop” + MQ “outer loop”, idempotent jobs, SSE streaming.
- **Security**: OAuth 2.1 + PKCE, least-privilege capabilities (MCP), sandboxed tools, OPA approvals, OTel traces.
- **Performance/Cost**: Prompt caching, hybrid context engine, queue-based autoscaling.
- **Modes**: Consumer (single-user, local-first) and Enterprise (multi-tenant, K8s).

## Quick start (dev)
```bash
docker compose -f compose.dev.yaml up -d
npm --workspace services/orchestrator install
npm --workspace services/orchestrator run dev
go run ./apps/gateway-api
```

## New: Consumer ↔ Enterprise flexibility
- Message bus: **RabbitMQ** or **Kafka** (toggle in Helm values).
- Providers: **OpenAI, Anthropic, Google, Azure OpenAI, AWS Bedrock, Mistral, OpenRouter, Local (Ollama)**.
- Auth: **API keys** and **OAuth** (where supported). See `docs/model-authentication.md`.

## Agent profiles
Create per-agent guides under `agents/<name>/agent.md` or via CLI:
```bash
npm --workspace apps/cli run build
./node_modules/.bin/aidt new-agent planner
```

See: `docs/agents/README.md`, `docs/consumer-enterprise-modes.md`, `docs/planner.md`.
