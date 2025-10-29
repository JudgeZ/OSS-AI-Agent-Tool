# CI/CD for OSS AI Agent Tool

This repository ships with **GitHub Actions** that:
1) Build and test on PRs (`CI`),  
2) Build, push, **sign (cosign)**, and generate **CycloneDX SBOMs** for Docker images on tags (`Release Images`), and  
3) Package and publish the **Helm chart** to **GitHub Pages** and **GHCR (OCI)** (`Release Helm Chart`).

## 1) CI (PRs & main)
- Workflow: `.github/workflows/ci.yml`
- Builds Go, Node, Rust components.
- Builds Docker images (no push).

## 2) Release images + signing + SBOM
- Workflow: `.github/workflows/release-images.yml`
- Trigger: push tags `v*` (e.g., `v0.2.0`).
- Actions:
  - Build & push to `ghcr.io/<owner>/oss-ai-agent-tool/<service>:{tag},latest`
  - **Sign images with `cosign` (keyless OIDC)** — no private key needed.
  - Generate **CycloneDX** SBOM with Syft and attach to GitHub Release.

**Required repository settings:**
- Settings → Actions → General → Workflow permissions → `Read and write permissions`
- Workflow file `permissions` already requests:
  - `packages: write`
  - `contents: write`
  - `id-token: write` (for **cosign keyless**)
- No secrets are needed for keyless signing; ensure OIDC is enabled (default on GitHub).

## 3) Release Helm Chart
- Workflow: `.github/workflows/release-charts.yml`
- Trigger: push tags `v*` or `chart-*`, or run manually.
- Publishes the chart in two ways:
  - **GitHub Pages index** (via `helm/chart-releaser-action`).
  - **OCI registry**: `oci://ghcr.io/<owner>/oss-ai-agent-tool/charts`.

**Install from OCI:**
```bash
helm registry login ghcr.io -u <you> -p <token>
helm pull oci://ghcr.io/<owner>/oss-ai-agent-tool/charts/oss-ai-agent-tool --version <x.y.z>
```

## Image coordinates in Helm
Set image repo/tag at install time:
```bash
helm upgrade --install oss-ai charts/oss-ai-agent-tool \
  --namespace oss-ai --create-namespace \
  --set image.repo=ghcr.io/<owner>/oss-ai-agent-tool \
  --set image.tag=<tag>
```

## Verifying signatures
```bash
cosign verify ghcr.io/<owner>/oss-ai-agent-tool/gateway-api:<tag>
cosign verify ghcr.io/<owner>/oss-ai-agent-tool/orchestrator:<tag>
cosign verify ghcr.io/<owner>/oss-ai-agent-tool/indexer:<tag>
```
