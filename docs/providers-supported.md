# Supported Providers (initial set)

| Provider        | Chat/Completion | Embeddings | Auth Modes                 | Notes |
|----------------|------------------|------------|----------------------------|-------|
| OpenAI         | Yes              | Yes        | API Key                    | Enterprise via Azure OpenAI also supported |
| Anthropic      | Yes              | -          | API Key                    |       |
| Google (Gemini)| Yes              | Yes        | OAuth (consumer), SA (ent) |       |
| Azure OpenAI   | Yes              | Yes        | AAD / API Key              |       |
| AWS Bedrock    | Yes              | Yes        | IAM                        |       |
| Mistral        | Yes              | Yes        | API Key                    |       |
| OpenRouter     | Yes              | Yes        | API Key / OAuth            | Consumer-friendly multi-model router |
| Local (Ollama) | Yes              | Yes        | None                       | Use for offline/local-first |
