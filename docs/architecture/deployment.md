# Deployment Model

- **Consumer**: Tauri desktop + Docker Compose; local secrets; API keys and OAuth loopback.
- **Enterprise**: Kubernetes + Helm; Kafka preferred; Vault/cloud secrets; OIDC SSO; CMEK; retention policies; audit logging.
- **Autoscaling**: HPA based on **queue depth** and latency SLOs.
- **Images**: GHCR published; **cosign** keyless signatures; **CycloneDX SBOMs** attached to releases.
