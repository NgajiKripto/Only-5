use crate::models::ValidationResult;

/// Whitelist of allowed commands
const ALLOWED_COMMANDS: &[&str] = &[
    "echo",
    "cat",
    "ls",
    "find",
    "grep",
    "curl",
    "wget",
    "nmap",
    "nikto",
    "openssl",
    "dig",
    "nslookup",
    "whois",
    "traceroute",
    "ping",
];

/// Shell injection patterns to reject in arguments
const DANGEROUS_PATTERNS: &[&str] = &[
    ";", "|", "&", "`", "$(", "${", ">", "<", ">>",
];

/// Validate a command and its arguments
pub fn validate(command: &str, args: &[String]) -> ValidationResult {
    // Reject empty commands
    if command.trim().is_empty() {
        return ValidationResult {
            valid: false,
            command: command.to_string(),
            reason: Some("Command cannot be empty".to_string()),
        };
    }

    // Reject if command starts with sudo or su
    if command.starts_with("sudo") || command.starts_with("su") {
        return ValidationResult {
            valid: false,
            command: command.to_string(),
            reason: Some("Privilege escalation commands are not allowed".to_string()),
        };
    }

    // Reject if command contains path traversal
    if command.contains("../") {
        return ValidationResult {
            valid: false,
            command: command.to_string(),
            reason: Some("Path traversal in command is not allowed".to_string()),
        };
    }

    // Check against whitelist
    let base_command = command.split('/').last().unwrap_or(command);
    if !ALLOWED_COMMANDS.contains(&base_command) {
        return ValidationResult {
            valid: false,
            command: command.to_string(),
            reason: Some(format!(
                "Command '{}' is not in the allowed commands list",
                base_command
            )),
        };
    }

    // Validate arguments don't contain shell injection patterns
    for arg in args {
        for pattern in DANGEROUS_PATTERNS {
            if arg.contains(pattern) {
                return ValidationResult {
                    valid: false,
                    command: command.to_string(),
                    reason: Some(format!(
                        "Argument contains dangerous pattern '{}'",
                        pattern
                    )),
                };
            }
        }
    }

    ValidationResult {
        valid: true,
        command: command.to_string(),
        reason: None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_valid_command() {
        let result = validate("echo", &["hello".to_string()]);
        assert!(result.valid);
        assert!(result.reason.is_none());
    }

    #[test]
    fn test_invalid_command() {
        let result = validate("rm", &["-rf".to_string(), "/".to_string()]);
        assert!(!result.valid);
        assert!(result.reason.unwrap().contains("not in the allowed"));
    }

    #[test]
    fn test_sudo_rejected() {
        let result = validate("sudo", &["rm".to_string()]);
        assert!(!result.valid);
        assert!(result.reason.unwrap().contains("Privilege escalation"));
    }

    #[test]
    fn test_path_traversal_rejected() {
        let result = validate("../../bin/sh", &[]);
        assert!(!result.valid);
        assert!(result.reason.unwrap().contains("Path traversal"));
    }

    #[test]
    fn test_shell_injection_in_args() {
        let result = validate("echo", &["hello; rm -rf /".to_string()]);
        assert!(!result.valid);
        assert!(result.reason.unwrap().contains("dangerous pattern"));
    }

    #[test]
    fn test_pipe_injection_in_args() {
        let result = validate("echo", &["hello | cat /etc/passwd".to_string()]);
        assert!(!result.valid);
    }

    #[test]
    fn test_subshell_injection_in_args() {
        let result = validate("echo", &["$(whoami)".to_string()]);
        assert!(!result.valid);
    }
}
