use alloy::providers::Provider;
use alloy::transports::Transport;
use axum::{routing::get, Router};
use eyre::Result;
use tracing::info;

use crate::handlers::search_handler;
use crate::state::AppState;

pub async fn run<P, T, H>(addr: &str, state: AppState<P, T, H>) -> Result<()>
where
    P: Provider<T> + Clone + 'static,
    T: Transport + Clone,
    H: Sync + Send + Clone + 'static,
{
    let app = Router::new()
        .route("/{chain}/{token}", get(search_handler))
        .with_state(state);

    info!("Server running on: {addr}");

    let listener = tokio::net::TcpListener::bind(&addr).await.unwrap();
    axum::serve(listener, app).await.unwrap();

    Ok(())
}
