# Docker Quickstart

Use Docker Compose to run the OSS AI Agent Tool's application containers locally. The provided stack spins up development environments for the orchestrator (Node.js) and gateway API (Go) so you can iterate on agents, flows, and HTTP surfaces without installing toolchains on the host. External dependencies (RabbitMQ, Redis, Postgres, Jaeger, Langfuse, etc.) are **not** included—point the services to managed instances or run them separately when you need end-to-end flows.

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

This command launches two containers:

| Service | Base image | Purpose |
| --- | --- | --- |
| `orchestrator` | `node:20-alpine` | Development shell for the orchestrator service |
| `gateway` | `golang:1.22-alpine` | Development shell for the gateway API |

Both containers mount the repository at `/workspace` and default to an idle `tail -f /dev/null` command so you can exec into them and run your preferred dev workflow. Start the processes you need from separate terminals, for example:

```bash
# Install dependencies (once per container)
docker compose -f compose.dev.yaml exec orchestrator npm install
docker compose -f compose.dev.yaml exec gateway go mod download

# Run the services
docker compose -f compose.dev.yaml exec orchestrator npm run dev --workspace services/orchestrator
docker compose -f compose.dev.yaml exec gateway go run ./apps/gateway-api
```

> **Note:** When you require message queues, databases, or observability backends, run them locally via separate containers (e.g., `docker run rabbitmq:3-management`) or connect to shared development infrastructure.

### Common flags

* `--detach` to run in the background.
* `--profile kafka` (future) when switching to Kafka-based deployments.

## 3. Verify services

Once the orchestrator and gateway processes are running inside their containers, verify the local endpoints:

* Gateway health: <http://localhost:8080/healthz>
* Orchestrator plan endpoint: <http://localhost:3000/plan>

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
