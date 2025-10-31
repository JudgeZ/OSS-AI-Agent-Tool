# Configuration

Primary sources:
- **Environment variables** (12-factor).
- **YAML file** `config/app.yaml` (mounted via Helm ConfigMap or `.env` override in Docker Compose).

```yaml
runMode: consumer                # or enterprise
messaging:
  type: rabbitmq                 # or kafka
providers:
  defaultRoute: "balanced"       # smallest-viable model that passes evals
  enabled:
    - openai
    - anthropic
    - google
    - azureopenai
    - bedrock
    - mistral
    - openrouter
    - local_ollama
auth:
  oauth:
    redirectBaseUrl: "http://localhost:8080"  # consumer loopback
secrets:
  backend: localfile             # or vault
tooling:
  agentEndpoint: "127.0.0.1:50051" # gRPC tool runner endpoint
  retryAttempts: 3
  defaultTimeoutMs: 15000
```

Values are merged with env vars at runtime. See the [Docker Quickstart](./docker-quickstart.md) for local overrides and the [Kubernetes Quickstart](./kubernetes-quickstart.md) for Helm value examples.

Relevant environment overrides:

| Variable | Description |
| --- | --- |
| `RUN_MODE` | Overrides `runMode` (`consumer` vs `enterprise`). Enterprise mode toggles Vault, Kafka, and stricter approval defaults (see [Consumer vs Enterprise](./consumer-enterprise-modes.md)). |
| `TOOL_AGENT_ENDPOINT` | Host:port for the tool agent gRPC server. |
| `TOOL_AGENT_RETRIES` | Overrides retry attempts for tool execution. |
| `TOOL_AGENT_TIMEOUT_MS` | Per-call timeout in milliseconds. |
| `MESSAGING_TYPE` (preferred) / `MESSAGE_BUS` (legacy) | Forces `rabbitmq` or `kafka` regardless of YAML setting (useful in CI matrices). |
| `SECRETS_BACKEND` | `localfile` or `vault`; coordinates with Helm `secrets.backend` and Compose mounts. |
| `LOCAL_SECRETS_PASSPHRASE` | Required when `secrets.backend: localfile`; decrypts the local keystore. |
| `LOCAL_SECRETS_PATH` | Optional override for the keystore path (defaults to `~/.oss-orchestrator/secrets.json`). |
| `GOOGLE_OAUTH_CLIENT_ID` / `GOOGLE_OAUTH_CLIENT_SECRET` | Optional overrides for Google OAuth refresh flow (defaults can also be stored in SecretsStore). |
| `GOOGLE_SERVICE_ACCOUNT` | Base64-safe JSON for Google service account credentials when running in enterprise mode. |
| `GOOGLE_API_KEY` | Direct API key fallback for Google Gemini when OAuth/service account are not available. |

## Messaging backends

| Setting | Effect |
| --- | --- |
| `messaging.type: rabbitmq` | Enables RabbitMQ deployments in Compose/Helm; provisions queues via `infra/helm/rabbitmq`. |
| `messaging.type: kafka` | Switches outer loop to Kafka; ensure the Kafka profile is enabled in Helm and refer to the Kafka values in `charts/oss-ai-agent-tool/values.yaml`. |

RabbitMQ is the default for local development. Kafka is recommended for enterprise deployments with higher throughput or durability requirements.

## Secrets backends

| Mode | Description |
| --- | --- |
| `localfile` | Encrypted JSON stored at `~/.oss-orchestrator/secrets.json` (override with `LOCAL_SECRETS_PATH`). Set `LOCAL_SECRETS_PASSPHRASE` to unlock the keystore; Docker Compose can load it via `.env`. |
| `vault` | HashiCorp Vault integration (enabled automatically when `runMode: enterprise`). Configure `VAULT_ADDR`, `VAULT_TOKEN`, or Kubernetes auth via Helm values. |

Refer to the [Security Threat Model](./SECURITY-THREAT-MODEL.md) for mitigations tied to each backend and ensure CI includes the appropriate secret scanning rules.

> **Note:** When the orchestrator boots with `secrets.backend: localfile` and no `LOCAL_SECRETS_PASSPHRASE` is provided, initialization fails with an explicit `LocalFileStore requires LOCAL_SECRETS_PASSPHRASE to be set` error so you can supply the passphrase before retrying.
