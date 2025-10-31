use std::env;

use anyhow::Result;
use tokio::signal;
use tracing::info;

const SERVICE_NAME: &str = "indexer";
const RUN_MODE_ENV: &str = "INDEXER_RUN_MODE";
const ONESHOT_MODE: &str = "oneshot";

#[tokio::main]
async fn main() -> Result<()> {
    init_tracing();

    let run_mode = env::var(RUN_MODE_ENV).unwrap_or_else(|_| String::from("daemon"));
    info!(target: SERVICE_NAME, mode = %run_mode, "Starting placeholder indexer service");

    if run_mode == ONESHOT_MODE {
        run_oneshot().await?;
    } else {
        run_daemon().await?;
    }

    info!(target: SERVICE_NAME, "Indexer shutdown complete");
    Ok(())
}

fn init_tracing() {
    if tracing::dispatcher::has_been_set() {
        return;
    }

    let env_filter = env::var("RUST_LOG").unwrap_or_else(|_| format!("{}=info", SERVICE_NAME));
    tracing_subscriber::fmt()
        .with_env_filter(env_filter)
        .with_target(true)
        .init();
}

async fn run_daemon() -> Result<()> {
    info!(target: SERVICE_NAME, "Placeholder indexer running; awaiting shutdown signal");
    signal::ctrl_c().await?;
    info!(target: SERVICE_NAME, "Shutdown signal received");
    Ok(())
}

async fn run_oneshot() -> Result<()> {
    info!(target: SERVICE_NAME, "Executing placeholder indexing cycle (one-shot mode)");
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn oneshot_mode_completes_without_waiting_for_signal() {
        init_tracing();
        env::set_var(RUN_MODE_ENV, ONESHOT_MODE);
        run_oneshot()
            .await
            .expect("one-shot mode should succeed without blocking");
        env::remove_var(RUN_MODE_ENV);
    }
}
