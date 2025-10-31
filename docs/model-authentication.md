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
  - `GET /auth/:provider/authorize` → generates PKCE + state, stores them temporarily, and redirects to the provider auth page.
  - `GET /auth/:provider/callback` → verifies state, posts the auth code + PKCE verifier to the orchestrator, then redirects the user back to the requested HTTPS destination.
- The **orchestrator** loads credentials via `SecretsStore` and injects them into provider SDKs.
- In **consumer mode**, tokens live in an encrypted local keystore. In **enterprise**, tokens are rotated and stored in Vault or cloud secret managers.

## Loopback OAuth (developer mode)

Some desktop clients (CLI / GUI) use a loopback redirect during OAuth consent. We support this by allowing `http://127.0.0.1` and `http://localhost` redirect URIs while requiring HTTPS everywhere else.

1. The client opens `GET /auth/:provider/authorize?redirect_uri=https://app.example.com/oauth-complete` (or a loopback URL during development).
2. The gateway generates a PKCE verifier + challenge, caches them with a random state, and redirects the browser to the provider's authorization page.
3. After consent, the provider calls back to `GET /auth/:provider/callback?code=...&state=...` on the gateway.
4. The gateway resolves the saved PKCE verifier, POSTs `{ code, code_verifier, redirect_uri }` to the orchestrator, and, on success, redirects the user to the original `redirect_uri` with `status=success`.
5. The orchestrator exchanges the code for tokens, encrypts them with the local passphrase (libsodium secretbox), and persists them to disk via `LocalFileStore`.

### Configuration

- `OPENROUTER_CLIENT_ID` / `OPENROUTER_CLIENT_SECRET`: OAuth client credentials for OpenRouter.
- `OAUTH_REDIRECT_BASE`: Public base URL for the gateway callback (defaults to `http://127.0.0.1:8080`).
- `LOCAL_SECRETS_PASSPHRASE`: Required passphrase for encrypting the local keystore (`~/.oss-orchestrator/secrets.json`).
- Optional: `LOCAL_SECRETS_PATH` to override the keystore location.

### Vault-backed secrets (enterprise)

Set `SECRETS_BACKEND=vault` to switch the orchestrator to the Vault-backed store. The service reads the
following environment variables to reach your Vault cluster:

- `VAULT_ADDR`: HTTPS endpoint for the Vault API (required).
- `VAULT_TOKEN`: Token with read/write access to the KV secrets engine (required).
- `VAULT_KV_MOUNT`: Mount name for the KV v2 engine (defaults to `kv`).
- `VAULT_SECRET_PREFIX`: Path prefix under the mount where orchestrator secrets are stored
  (defaults to `oss/orchestrator`).
- `VAULT_NAMESPACE`: Optional Vault namespace for multi-tenant clusters.
- `VAULT_CA_CERT`: Optional CA certificate path for self-signed Vault deployments.
- `VAULT_TLS_REJECT_UNAUTHORIZED`: Set to `false`/`0` to allow self-signed TLS when you cannot
  supply a CA certificate (defaults to strict verification).

Secrets are written to `${VAULT_KV_MOUNT}/data/${VAULT_SECRET_PREFIX}/…` and deleted via the corresponding
`metadata` endpoint so that previous versions are also removed.
