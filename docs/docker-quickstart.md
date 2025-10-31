# Docker Quickstart

Use Docker Compose to run the OSS AI Agent Tool locally with RabbitMQ, Postgres, Redis, Jaeger, and Langfuse. This setup mirrors the **consumer** run mode and is ideal for agent template development, provider integration testing, and end-to-end demos.

## Prerequisites

* Docker Engine 24+
* Docker Compose Plugin (`docker compose`)
* Node.js 20+ (for local CLI usage)
* Access tokens for any external model providers you plan to exercise (see [Model Authentication](./model-authentication.md))

## 1. Clone and configure

```bash
git clone https://github.com/<owner>/OSS-AI-Agent-Tool.git
cd OSS-AI-Agent-Tool
cp config/app.example.yaml config/app.yaml
```

Edit `config/app.yaml` (or set environment variables) to match your provider credentials and messaging preferences. See [Configuration](./configuration.md) for the full schema.

Key options for local Compose:

```yaml
runMode: consumer
messaging:
  type: rabbitmq
providers:
  defaultRoute: balanced
secrets:
  backend: localfile
```

## 2. Start the stack

```bash
docker compose -f compose.dev.yaml up --build
```

This command launches the following containers:

| Service | Image | Purpose |
| --- | --- | --- |
| `gateway-api` | Go binary | OAuth loopback endpoints, SSE proxy |
| `orchestrator` | Node.js | Plan execution and agent routing |
| `indexer` | Rust skeleton | Placeholder for future symbolic index |
| `memory-svc` | Node.js | Cache/state glue for agents |
| `rabbitmq` | Official RabbitMQ | Message bus for the outer loop |
| `redis` | Redis | Tool/cache storage |
| `postgres` | Postgres | Plan and audit storage |
| `jaeger` | Jaeger all-in-one | Trace viewer |
| `langfuse` | Langfuse | LLM tracing and prompt analytics |

### Common flags

* `--detach` to run in the background.
* `--profile kafka` (future) when switching to Kafka-based deployments.

## 3. Verify services

* Gateway health: <http://localhost:8080/healthz>
* Orchestrator plan endpoint: <http://localhost:3000/plan>
* Jaeger UI: <http://localhost:16686>
* Langfuse UI: <http://localhost:3001>

Use the CLI to generate a plan and agent skeleton:

```bash
npm install --workspace apps/cli
npx aidt plan "Ship MVP inner loop"
npx aidt new-agent reviewer
```

## 4. Develop agents locally

1. Edit `agents/<name>/agent.md` to update capabilities and guidance (see [Agents](./agents.md)).
2. Run orchestrator tests:
   ```bash
   npm test --workspace services/orchestrator
   ```
3. Tail container logs as needed:
   ```bash
   docker compose -f compose.dev.yaml logs orchestrator -f
   ```

## 5. Shut down

```bash
docker compose -f compose.dev.yaml down
```

Add `--volumes` to drop persistent data between sessions.

## Next steps

* Ready for production-like deployments? Continue with the [Kubernetes Quickstart](./kubernetes-quickstart.md).
* Need SBOMs or signed images? See [CI/CD](./ci-cd.md) for the release workflows.
* Review security mitigations in the [Threat Model](./SECURITY-THREAT-MODEL.md) before exposing services beyond localhost.
