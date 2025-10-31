# CI/CD for OSS AI Agent Tool

The repository ships with **four GitHub Actions workflows** that cover build/test automation, release packaging, and continuous security scanning. All workflows are located in `.github/workflows/` and support manual dispatches for ad-hoc runs. When running the stack locally or in Kubernetes, pair these workflows with the [Docker Quickstart](./docker-quickstart.md) and [Kubernetes Quickstart](./kubernetes-quickstart.md) guides to validate artifacts end-to-end.

## Continuous Integration (`ci.yml`)
- **Triggers:** pull requests targeting `main`, pushes to `main`, or manual `Run workflow` dispatches.
- **What runs:**
  - Go formatting/vet/test (`go fmt`, `go vet`, `go test`) whenever a `go.mod` is present.
  - TypeScript linting, `tsc --noEmit` type-checks, unit tests (via `npm test --if-present`), and builds for each workspace (`services/orchestrator`, `apps/cli`).
  - Rust `fmt`, `clippy`, and `cargo test` when a `Cargo.toml` appears (future indexer service).
- **Pass criteria:** all language jobs must succeed; any lint/test failure blocks the PR/merge.

### How to run it manually
1. Navigate to **Actions → CI → Run workflow**.
2. Select the target branch (default: `main`).
3. Click **Run workflow**.

## Container Releases (`release-images.yml`)
- **Triggers:** annotated/lightweight tags matching `v*` (e.g., `v0.3.0`) or manual dispatch.
- **What runs:** for each service with a Dockerfile (`apps/gateway-api`, `services/orchestrator`, `services/indexer`, `services/memory-svc`), the workflow:
  1. Builds and pushes multi-arch images to `ghcr.io/<owner>/oss-ai-agent-tool/<service>`.
  2. Generates a CycloneDX JSON SBOM via `anchore/sbom-action`.
  3. Performs **keyless cosign signing** using GitHub OIDC (`id-token: write` permission — no secrets required).
  4. Uploads the SBOM to the GitHub Release and retains it as an artifact.

### Repository/permission requirements
- Settings → Actions → General → Workflow permissions → **Read and write permissions**.
- Default `GITHUB_TOKEN` scopes are sufficient (`contents: write`, `packages: write`, `id-token: write`).
- Ensure GitHub Packages is enabled for the organization; no additional secrets are necessary for cosign keyless signing.

### Manual release run
1. Create a tag (`git tag v0.3.0 && git push origin v0.3.0`) **or** trigger via Actions → Release Images → Run workflow.
2. Monitor the workflow for SBOM assets and cosign signature logs.
3. Download SBOMs from the job summary or the GitHub Release attachments.

## Helm Chart Publishing (`release-charts.yml`)
- **Triggers:** `v*` or `chart-*` tags, plus manual dispatches. Chart artifacts feed directly into the [Kubernetes Quickstart](./kubernetes-quickstart.md).
- **What runs:**
  - `helm lint` and `helm package` for `charts/oss-ai-agent-tool` (RabbitMQ and Kafka assets, Jaeger/Langfuse, Ingress templates).
  - Publishes the chart to the GitHub Pages index via `helm/chart-releaser-action`.
  - Pushes OCI artifacts to `oci://ghcr.io/<owner>/oss-ai-agent-tool/charts` after logging into GHCR with the Actions token.

### Install from OCI
```bash
helm registry login ghcr.io -u <github-username> -p <personal-access-token>
helm pull oci://ghcr.io/<owner>/oss-ai-agent-tool/charts/oss-ai-agent-tool --version <x.y.z>
```

### Manual chart release
1. Tag the repo (`git tag chart-0.3.0 && git push origin chart-0.3.0`) or dispatch from Actions.
2. Confirm the workflow published a `.tgz` to the `gh-pages` branch and pushed the OCI artifact.
3. Update downstream environments with the new chart version.

## Security Scanning (`security.yml`)
- **Triggers:** pull requests, pushes to `main`, a weekly cron (`0 3 * * 1`), and manual dispatches.
- **What runs:**
  - Trivy filesystem scan (CRITICAL/HIGH severities fail the job).
  - Trivy container image scans for each Dockerfile (skips automatically when a Dockerfile is absent).
  - Semgrep SAST using the `auto` ruleset.
  - CodeQL analysis for Go and TypeScript/JavaScript.
  - Gitleaks secret detection (`detect --redact`).
- **Why it matters:** all jobs must pass; any vulnerability or secret finding blocks merges until addressed.

## Release notes automation (`release-drafter.yml`)
`Release Drafter` groups merged pull requests by category and prepares draft notes tagged as `v<next patch>`. It runs automatically via the GitHub App once enabled in repository settings. Reference the [Security Threat Model](./SECURITY-THREAT-MODEL.md) and [Security Scanning](./security-scanning.md) docs when summarizing risk mitigations in release notes.

## Renovate
`renovate.json` (already present) continues to manage dependency update PRs. Combine it with the CI & security workflows to ensure automated updates remain safe.
