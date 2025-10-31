# Docker Quickstart

Use Docker Compose to run the OSS AI Agent Tool's application containers locally. The provided stack builds the orchestrator (Node.js), gateway API (Go), indexer (Rust), and memory service scaffold, and it also launches the full set of supporting dependencies (Redis, Postgres, RabbitMQ, Kafka, Jaeger, Langfuse). This mirrors the development topology defined in `compose.dev.yaml` so you can exercise flows without wiring additional containers by hand. Run `docker compose -f compose.dev.yaml config --services` if you want to confirm the service list locally.

## Prerequisites

* Docker Engine 24+
* Docker Compose Plugin (`docker compose`)
* Node.js 20+ (for local CLI usage)
* Access tokens for any external model providers you plan to exercise (see [Model Authentication](./model-authentication.md))

## 1. Clone and configure

```bash
git clone https://github.com/<owner>/OSS-AI-Agent-Tool.git
cd OSS-AI-Agent-Tool
mkdir -p config
cat <<'EOF' > config/app.yaml
runMode: consumer
messaging:
  type: rabbitmq
providers:
  defaultRoute: balanced
secrets:
  backend: localfile
EOF
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

Compose will build images for the in-repo services and then start the following containers (entrypoints reflect the effective command from `docker compose config`):

| Service | Image / build context | Entrypoint or command | Exposed ports | Purpose |
| --- | --- | --- | --- | --- |
| `gateway` | `./apps/gateway-api` → distroless | `/gateway-api` | `8080` | Serves the Gateway HTTP API with SSE endpoints. |
| `orchestrator` | `./services/orchestrator` | `node dist/index.js` | `4000` | Runs orchestration flows and provider integrations. |
| `indexer` | `./services/indexer` → distroless | `/app/indexer` | `7070` | Provides AST/indexing APIs for repositories. |
| `memory-svc` | `node:20-alpine` | `tail -f /dev/null` | _n/a_ | Development container for building the memory service. |
| `redis` | `redis/redis-stack-server:7.2.0-v9` | default | `6379` | In-memory cache and vector store. |
| `postgres` | `postgres:15-alpine` | default | `5432` | Application relational datastore. |
| `rabbitmq` | `rabbitmq:3.13-management` | default | `5672`, `15672` | Message queue plus management UI. |
| `kafka` | `bitnami/kafka:3.7.0` | default | `9092` | Event backbone (KRaft mode). |
| `jaeger` | `jaegertracing/all-in-one:1.57` | default | `16686`, `4317`, `4318` | Observability UI and OTLP collectors. |
| `langfuse` | `langfuse/langfuse:2.14.1` | default | `3000` | LLM tracing and analytics dashboard. |

Because `gateway`, `orchestrator`, and `indexer` start their servers automatically, you can interact with them immediately after the `up` command finishes.

> **Need a slimmer stack?** Limit the services you bring up, for example `docker compose -f compose.dev.yaml up gateway orchestrator redis postgres rabbitmq`, or create a local override file with the dependencies you require. Comments in `compose.dev.yaml` note where future profiles (e.g., Kafka) will land.

### Common flags

* `--detach` to run in the background.
* `--profile <name>` when you add your own Compose profiles in a local override to slim the stack further.

## 3. Verify services

Once the containers show `healthy`/`running` status, verify the local endpoints:

* Gateway health: <http://localhost:8080/healthz>
* Orchestrator plan endpoint: <http://localhost:4000/plan>
* Indexer status: <http://localhost:7070/healthz>
* RabbitMQ management UI: <http://localhost:15672> (user/pass `guest`/`guest`)
* Jaeger UI: <http://localhost:16686>
* Langfuse UI: <http://localhost:3000> (defaults seeded via `compose.dev.yaml`)

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
