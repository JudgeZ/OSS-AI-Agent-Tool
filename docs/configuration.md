# Configuration

Primary sources:
- **Environment variables** (12-factor).
- **YAML file** `config/app.yaml`.

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
  vault:
    address: ${VAULT_ADDR}
    mount: kv
    prefix: oss/orchestrator
    namespace: ${VAULT_NAMESPACE}
    caCertPath: ${VAULT_CA_CERT}
    tlsRejectUnauthorized: true
```

Values are merged with env vars at runtime.

### Vault options

When `SECRETS_BACKEND=vault`, the orchestrator reads the following environment variables:

- `VAULT_ADDR`: Base URL for the Vault API (required).
- `VAULT_TOKEN`: Token used for API calls (required).
- `VAULT_KV_MOUNT`: KV v2 mount (default: `kv`).
- `VAULT_SECRET_PREFIX`: Path prefix within the mount (default: `oss/orchestrator`).
- `VAULT_NAMESPACE`: Optional namespace header for Vault Enterprise.
- `VAULT_CA_CERT`: Optional path to a CA certificate for TLS verification.
- `VAULT_TLS_REJECT_UNAUTHORIZED`: Set to `false`/`0` to skip TLS verification when necessary.
