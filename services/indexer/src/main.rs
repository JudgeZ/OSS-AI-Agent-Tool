use axum::{routing::get, Json, Router};
use serde::Serialize;
use std::net::SocketAddr;
use thiserror::Error;
use tokio::net::TcpListener;
use tracing::{error, info};

#[derive(Debug, Serialize)]
struct HealthResponse {
    status: &'static str,
}

#[derive(Debug, Error)]
enum IndexerError {
    #[error("bind error: {0}")]
    Bind(#[source] std::io::Error),
    #[error("signal handling error: {0}")]
    Signal(#[source] std::io::Error),
    #[error("server error: {0}")]
    Server(#[source] std::io::Error),
}

async fn healthcheck() -> Json<HealthResponse> {
    Json(HealthResponse { status: "ok" })
}

async fn run() -> Result<(), IndexerError> {
    tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::from_default_env())
        .without_time()
        .init();

    let app = Router::new().route("/healthz", get(healthcheck));

    let addr: SocketAddr = ([0, 0, 0, 0], 7070).into();
    let listener = TcpListener::bind(addr).await.map_err(IndexerError::Bind)?;
    let bound_addr = listener.local_addr().map_err(IndexerError::Bind)?;
    info!(%bound_addr, "starting indexer");

    axum::serve(listener, app)
        .with_graceful_shutdown(async {
            if let Err(err) = shutdown_signal().await {
                error!(%err, "shutdown signal error");
            }
        })
        .await
        .map_err(IndexerError::Server)?;

    info!("indexer stopped");
    Ok(())
}

async fn shutdown_signal() -> Result<(), IndexerError> {
    #[cfg(unix)]
    {
        use tokio::signal::unix::{signal, SignalKind};

        let mut terminate = signal(SignalKind::terminate()).map_err(IndexerError::Signal)?;
        tokio::select! {
            res = tokio::signal::ctrl_c() => res.map_err(IndexerError::Signal)?,
            _ = terminate.recv() => {}
        }
    }

    #[cfg(not(unix))]
    {
        tokio::signal::ctrl_c()
            .await
            .map_err(IndexerError::Signal)?;
    }

    Ok(())
}

#[tokio::main]
async fn main() -> Result<(), IndexerError> {
    run().await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn healthcheck_returns_ok() {
        let Json(resp) = healthcheck().await;
        assert_eq!(resp.status, "ok");
    }
}
