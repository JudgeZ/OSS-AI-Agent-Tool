# Model Provider Authentication

We support **API key** and **OAuth/OIDC** (where providers allow it).

## Remote providers (examples)
- **OpenAI**: API key (OAuth not generally available for inference). 
- **Anthropic**: API key.
- **Google (Gemini)**: OAuth (consumer) or Service Account (enterprise).
- **Azure OpenAI**: Azure AD (service principal) or API key.
- **AWS Bedrock**: AWS IAM roles/keys.
- **Mistral**: API key.
- **OpenRouter**: API key or OAuth (consumer-friendly).

## Local providers
- **Ollama / llama.cpp**: local HTTP endpoint or CLI; no external auth.

## How it works
- The **gateway-api** exposes:
  - `GET /auth/:provider/authorize` → redirects to provider auth page (OAuth-capable providers).
  - `GET /auth/:provider/callback` → stores tokens in the selected secrets backend.
- The **orchestrator** loads credentials via `SecretsStore` and injects them into provider SDKs.
- In **consumer mode**, tokens live in an encrypted local keystore. In **enterprise**, tokens are rotated and stored in Vault or cloud secret managers.
