mod executor;
mod models;
mod parser;
mod sanitizer;
mod validator;

use axum::{routing::{get, post}, Json, Router};
use tower_http::cors::{Any, CorsLayer};
use tracing_subscriber::EnvFilter;

use models::{
    ExecutionRequest, ExecutionResult, HealthResponse, SanitizeResult, ValidationResult,
};

/// POST /execute - Validate and execute a command
async fn handle_execute(Json(request): Json<ExecutionRequest>) -> Json<ExecutionResult> {
    let result = executor::execute(request).await;
    Json(result)
}

/// POST /validate - Validate a command without executing
async fn handle_validate(Json(request): Json<ExecutionRequest>) -> Json<ValidationResult> {
    let result = validator::validate(&request.command, &request.args);
    Json(result)
}

/// POST /sanitize - Sanitize input string
async fn handle_sanitize(Json(body): Json<SanitizeInput>) -> Json<SanitizeResult> {
    let result = sanitizer::sanitize(&body.input);
    Json(result)
}

/// GET /health - Health check endpoint
async fn handle_health() -> Json<HealthResponse> {
    Json(HealthResponse {
        status: "healthy".to_string(),
        service: "executor".to_string(),
        version: env!("CARGO_PKG_VERSION").to_string(),
    })
}

/// Input body for sanitize endpoint
#[derive(serde::Deserialize)]
struct SanitizeInput {
    input: String,
}

#[tokio::main]
async fn main() {
    // Initialize tracing
    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::from_default_env().add_directive("executor=info".parse().unwrap()))
        .init();

    tracing::info!("Starting executor service v{}", env!("CARGO_PKG_VERSION"));

    // Configure CORS
    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods(Any)
        .allow_headers(Any);

    // Build router
    let app = Router::new()
        .route("/execute", post(handle_execute))
        .route("/validate", post(handle_validate))
        .route("/sanitize", post(handle_sanitize))
        .route("/health", get(handle_health))
        .layer(cors);

    // Bind to port 7003
    let listener = tokio::net::TcpListener::bind("0.0.0.0:7003")
        .await
        .expect("Failed to bind to port 7003");

    tracing::info!("Executor service listening on 0.0.0.0:7003");

    // Serve with graceful shutdown
    axum::serve(listener, app)
        .with_graceful_shutdown(shutdown_signal())
        .await
        .expect("Server error");
}

/// Wait for SIGTERM or SIGINT for graceful shutdown
async fn shutdown_signal() {
    let ctrl_c = async {
        tokio::signal::ctrl_c()
            .await
            .expect("Failed to install Ctrl+C handler");
    };

    #[cfg(unix)]
    let terminate = async {
        tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
            .expect("Failed to install SIGTERM handler")
            .recv()
            .await;
    };

    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();

    tokio::select! {
        _ = ctrl_c => {},
        _ = terminate => {},
    }

    tracing::info!("Shutdown signal received, starting graceful shutdown");
}
