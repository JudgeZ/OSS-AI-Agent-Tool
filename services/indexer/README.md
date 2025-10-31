# Indexer Service

This crate hosts the placeholder implementation of the Rust-based indexer. It currently wires up logging and a basic runtime loop so the CI pipeline can build, format, lint, and execute smoke tests. The binary defaults to daemon mode, waiting for a shutdown signal, and provides a `INDEXER_RUN_MODE=oneshot` mode that exits immediately for health checks and automated tests.

## Development

```bash
cargo fmt
cargo clippy --all-targets --all-features
INDEXER_RUN_MODE=oneshot cargo run
```

## Testing

```bash
cargo test
```
