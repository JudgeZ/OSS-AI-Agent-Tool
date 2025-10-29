# ADR 0004: Multi-Provider & Multi-Auth

- Status: Accepted
- Context: Users need local models, consumer OAuth/API keys, and enterprise clouds.
- Decision: Pluggable **ModelProvider** registry; support API keys and OAuth/OIDC; add enterprise auth (Azure AD, AWS IAM).
- Consequences: More integration points; higher coverage.
- Alternatives: Single vendor; API key only.
