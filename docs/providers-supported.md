# Supported Providers (initial set)

| Provider        | Chat/Completion | Embeddings | Auth Modes                 | Notes |
|----------------|------------------|------------|----------------------------|-------|
| OpenAI         | Yes              | Yes        | API Key                    | Enterprise via Azure OpenAI also supported |
| Anthropic      | Yes              | -          | API Key                    | Claude 3 via direct or Bedrock |
| Google (Gemini)| Yes              | Yes        | API Key / OAuth            | OAuth used for consumer tenants |
| Azure OpenAI   | Yes              | Yes        | AAD / API Key              | Uses customer deployments |
| AWS Bedrock    | Yes              | Yes        | IAM                        | Anthropic + Cohere routes |
| Mistral        | Yes              | Yes        | API Key                    |       |
| OpenRouter     | Yes              | Yes        | API Key / OAuth            | Consumer-friendly multi-model router |
| Local (Ollama) | Yes              | Yes        | None                       | Use for offline/local-first |

All adapters resolve credentials through the shared `SecretsStore` abstraction and raise structured `ProviderError` instances
with retry hints so the orchestrator can fail over gracefully.

## Secrets configuration

| Provider | SecretsStore key(s) | Environment fallback | Notes |
|----------|---------------------|-----------------------|-------|
| OpenAI | `provider:openai:apiKey` | `OPENAI_API_KEY` | Required to construct the SDK client. |
| Anthropic | `provider:anthropic:apiKey` | `ANTHROPIC_API_KEY` | Powers Claude 3 via Messages API. |
| Google Gemini | `provider:google:apiKey` | `GOOGLE_API_KEY` | Used for server-to-server Gemini access. |
| Azure OpenAI | `provider:azureopenai:apiKey`, `provider:azureopenai:endpoint`, `provider:azureopenai:deployment` | `AZURE_OPENAI_API_KEY`, `AZURE_OPENAI_ENDPOINT`, `AZURE_OPENAI_DEPLOYMENT` | Deployment name may also be supplied in the chat request. |
| AWS Bedrock | `provider:bedrock:accessKeyId`, `provider:bedrock:secretAccessKey`, optional `provider:bedrock:sessionToken`, optional `provider:bedrock:region` | `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_SESSION_TOKEN`, `AWS_REGION` | Region defaults to `us-east-1` when not provided. |
| Mistral | `provider:mistral:apiKey` | `MISTRAL_API_KEY` | Supports chat + embeddings. |
| OpenRouter | `provider:openrouter:apiKey` | `OPENROUTER_API_KEY` | Falls back to OAuth access token when available. |
| Local Ollama | `provider:ollama:baseUrl` | `OLLAMA_BASE_URL` | Defaults to `http://127.0.0.1:11434`. |

## OAuth grants

| Provider | SecretsStore key | Scopes / notes |
|----------|------------------|----------------|
| Google Gemini (consumer) | `oauth:google:access_token` | Optional override when the tenant completes OAuth instead of API keys. |
| OpenRouter | `oauth:openrouter:access_token` | Preferred for consumer accounts; SDK falls back to API key when absent. |

## Default model routing

| Provider | Default model identifier | Customisation |
|----------|-------------------------|---------------|
| OpenAI | `gpt-4o-mini` | Override per-request via `model` or set a provider default. |
| Anthropic | `claude-3-sonnet-20240229` | `max_tokens` capped at 1024 by default. |
| Google Gemini | `gemini-1.5-flash` | System prompt applied when supplied in messages. |
| Azure OpenAI | Uses configured deployment | Deployment must reference the target model. |
| AWS Bedrock | `anthropic.claude-3-sonnet-20240229-v1:0` | Supports custom region + model id. |
| Mistral | `mistral-large-latest` | Fully controllable via request `model`. |
| OpenRouter | `openrouter/openai/gpt-4o-mini` | Router honors provider overrides/ordering. |
| Local Ollama | `llama3.1` | Base URL configurable per-tenant. |
