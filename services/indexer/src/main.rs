use anyhow::Context;
use tracing::{info, warn};

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::from_default_env())
        .with_target(false)
        .init();

    info!(event = "starting", msg = "indexer service booting");

    // Placeholder task until real indexing pipeline is implemented.
    if let Err(err) = tokio::signal::ctrl_c().await.context("failed to await ctrl_c signal") {
        warn!(error = %err, "failed to listen for shutdown signal");
    }

    info!(event = "shutting_down", msg = "indexer service exiting");
    Ok(())
}
