# Security Scanning

This repo enables multiple layers of security checks:

- **Trivy** (containers + IaC): file system, secrets, and misconfiguration scanning; Helm/K8s config checks.
- **Semgrep** (SAST): rulesets via `p/ci`; optional upload to Semgrep App with `SEMGREP_APP_TOKEN`.
- **Gitleaks**: fast secrets scanning.
- **CodeQL**: deep code analysis for supported languages.
- **Cosign**: keyless signing of release images.
- **CycloneDX**: SBOMs for each image; attached to Releases.

## Required/optional secrets
- `SEMGREP_APP_TOKEN` (optional) for Semgrep App reporting.
- `GITHUB_TOKEN` (provided by Actions) for GHCR push and code scanning SARIF uploads.
