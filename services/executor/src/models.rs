use serde::{Deserialize, Serialize};

/// Request to execute a command
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExecutionRequest {
    pub command: String,
    pub args: Vec<String>,
    pub timeout_ms: Option<u64>,
    pub working_dir: Option<String>,
}

/// Result of execution
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExecutionResult {
    pub id: String,
    pub success: bool,
    pub stdout: String,
    pub stderr: String,
    pub exit_code: Option<i32>,
    pub duration_ms: u64,
    pub findings: Vec<Finding>,
    pub error: Option<String>,
}

/// Extracted finding from output
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Finding {
    pub line: usize,
    pub content: String,
    pub finding_type: String,
}

/// Validation result
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ValidationResult {
    pub valid: bool,
    pub command: String,
    pub reason: Option<String>,
}

/// Sanitization result
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SanitizeResult {
    pub original: String,
    pub sanitized: String,
    pub changes: Vec<String>,
}

/// Health check response
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HealthResponse {
    pub status: String,
    pub service: String,
    pub version: String,
}
