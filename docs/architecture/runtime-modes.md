# Runtime Modes

| Aspect      | Consumer                         | Enterprise                                   |
|-------------|----------------------------------|----------------------------------------------|
| Secrets     | Local keystore                   | Vault/Cloud KMS (per-tenant keys)            |
| Messaging   | RabbitMQ (default)               | Kafka (preferred) or RabbitMQ                |
| Auth        | API keys + OAuth loopback        | OIDC SSO + provider-native auth              |
| Observability | local collector (optional)     | OTel collector + Jaeger/Langfuse             |
| Compliance  | Minimal                          | DPIA, retention, data exports, system cards  |
