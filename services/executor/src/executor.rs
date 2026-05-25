use std::time::Instant;
use tokio::process::Command;
use tokio::time::{timeout, Duration};
use uuid::Uuid;

use crate::models::{ExecutionRequest, ExecutionResult};
use crate::parser::parse_json_lines;
use crate::validator::validate;

/// Default timeout in milliseconds
const DEFAULT_TIMEOUT_MS: u64 = 30000;

/// Execute a command after validation
pub async fn execute(request: ExecutionRequest) -> ExecutionResult {
    let id = Uuid::new_v4().to_string();
    let timeout_ms = request.timeout_ms.unwrap_or(DEFAULT_TIMEOUT_MS);

    // Validate the command first
    let validation = validate(&request.command, &request.args);
    if !validation.valid {
        return ExecutionResult {
            id,
            success: false,
            stdout: String::new(),
            stderr: String::new(),
            exit_code: None,
            duration_ms: 0,
            findings: Vec::new(),
            error: validation.reason,
        };
    }

    // Build command
    let mut cmd = Command::new(&request.command);
    cmd.args(&request.args);

    if let Some(ref dir) = request.working_dir {
        cmd.current_dir(dir);
    }

    // Capture output
    cmd.stdout(std::process::Stdio::piped());
    cmd.stderr(std::process::Stdio::piped());

    let start = Instant::now();

    // Execute with timeout
    let result = timeout(Duration::from_millis(timeout_ms), cmd.output()).await;

    let duration_ms = start.elapsed().as_millis() as u64;

    match result {
        Ok(Ok(output)) => {
            let stdout = String::from_utf8_lossy(&output.stdout).to_string();
            let stderr = String::from_utf8_lossy(&output.stderr).to_string();
            let exit_code = output.status.code();
            let success = output.status.success();
            let findings = parse_json_lines(&stdout);

            ExecutionResult {
                id,
                success,
                stdout,
                stderr,
                exit_code,
                duration_ms,
                findings,
                error: None,
            }
        }
        Ok(Err(e)) => ExecutionResult {
            id,
            success: false,
            stdout: String::new(),
            stderr: String::new(),
            exit_code: None,
            duration_ms,
            findings: Vec::new(),
            error: Some(format!("Failed to execute command: {}", e)),
        },
        Err(_) => ExecutionResult {
            id,
            success: false,
            stdout: String::new(),
            stderr: String::new(),
            exit_code: None,
            duration_ms,
            findings: Vec::new(),
            error: Some(format!(
                "Command timed out after {}ms",
                timeout_ms
            )),
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_execute_echo() {
        let request = ExecutionRequest {
            command: "echo".to_string(),
            args: vec!["hello world".to_string()],
            timeout_ms: Some(5000),
            working_dir: None,
        };

        let result = execute(request).await;
        assert!(result.success);
        assert!(result.stdout.contains("hello world"));
        assert!(result.error.is_none());
        assert!(result.duration_ms < 5000);
    }

    #[tokio::test]
    async fn test_execute_invalid_command() {
        let request = ExecutionRequest {
            command: "rm".to_string(),
            args: vec!["-rf".to_string(), "/".to_string()],
            timeout_ms: Some(5000),
            working_dir: None,
        };

        let result = execute(request).await;
        assert!(!result.success);
        assert!(result.error.is_some());
        assert!(result.error.unwrap().contains("not in the allowed"));
    }

    #[tokio::test]
    async fn test_execute_with_timeout() {
        let request = ExecutionRequest {
            command: "find".to_string(),
            args: vec!["/".to_string()],
            timeout_ms: Some(50),
            working_dir: None,
        };

        let result = execute(request).await;
        assert!(!result.success);
        assert!(result.error.is_some());
        assert!(result.error.unwrap().contains("timed out"));
    }

    #[tokio::test]
    async fn test_execute_shell_injection_rejected() {
        let request = ExecutionRequest {
            command: "echo".to_string(),
            args: vec!["hello; rm -rf /".to_string()],
            timeout_ms: Some(5000),
            working_dir: None,
        };

        let result = execute(request).await;
        assert!(!result.success);
        assert!(result.error.is_some());
    }
}
