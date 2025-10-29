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
```

Values are merged with env vars at runtime.
