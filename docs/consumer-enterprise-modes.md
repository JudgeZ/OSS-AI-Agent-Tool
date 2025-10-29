# Consumer vs Enterprise Modes

This app runs in **consumer** (single-user, local-first) and **enterprise** (multi-tenant, centralized) modes.

## Consumer
- **Runtime**: Tauri desktop + local services via Docker Compose.
- **Auth**: API keys (stored locally) and OAuth for providers that support consumer OAuth (e.g., Google, OpenRouter).
- **Messaging**: default **RabbitMQ** (lightweight). Kafka optional.
- **Secrets**: encrypted local keystore (OS keychain or file-based with passphrase).

## Enterprise
- **Runtime**: Kubernetes with Helm; multi-tenant orchestrator.
- **Auth**: OIDC (SSO for users), OAuth/OIDC or provider-native auth for model providers.
- **Messaging**: **Kafka** (preferred) or RabbitMQ based on org standards.
- **Secrets**: cloud secret manager or Vault; **CMEK** per tenant; audit logging + OTel traces.
- **Compliance**: DPIA, data retention, system cards, SBOMs, signed releases.

## Switching modes
Set `RUN_MODE=consumer|enterprise`. Behavior differences:
- Secrets backend (`LocalFileStore` vs `VaultStore`).
- Messaging implementation injected at runtime.
- OAuth callback host (desktop loopback for consumer; HTTPS domain for enterprise).
