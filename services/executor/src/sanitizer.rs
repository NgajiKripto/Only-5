use crate::models::SanitizeResult;

/// Shell metacharacters to strip
const METACHARACTERS: &[char] = &[';', '|', '&', '`', '$', '{', '}', '(', ')', '>', '<'];

/// Sanitize input by stripping dangerous characters and normalizing
pub fn sanitize(input: &str) -> SanitizeResult {
    let original = input.to_string();
    let mut sanitized = input.to_string();
    let mut changes: Vec<String> = Vec::new();

    // Strip null bytes
    if sanitized.contains('\0') {
        sanitized = sanitized.replace('\0', "");
        changes.push("Stripped null bytes".to_string());
    }

    // Strip shell metacharacters
    let before_meta = sanitized.clone();
    sanitized = sanitized.chars().filter(|c| !METACHARACTERS.contains(c)).collect();
    if sanitized != before_meta {
        changes.push("Stripped shell metacharacters".to_string());
    }

    // Normalize paths - remove ../
    if sanitized.contains("../") {
        sanitized = sanitized.replace("../", "");
        changes.push("Removed path traversal sequences (../)".to_string());
    }

    // Normalize paths - remove ./
    if sanitized.contains("./") {
        sanitized = sanitized.replace("./", "");
        changes.push("Removed relative path sequences (./)".to_string());
    }

    // Trim excessive whitespace (multiple spaces to single)
    let before_ws = sanitized.clone();
    let parts: Vec<&str> = sanitized.split_whitespace().collect();
    sanitized = parts.join(" ");
    if sanitized != before_ws {
        changes.push("Normalized excessive whitespace".to_string());
    }

    SanitizeResult {
        original,
        sanitized,
        changes,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_strip_metacharacters() {
        let result = sanitize("hello; world | test");
        assert_eq!(result.sanitized, "hello world test");
        assert!(result.changes.iter().any(|c| c.contains("metacharacters")));
    }

    #[test]
    fn test_strip_null_bytes() {
        let result = sanitize("hello\0world");
        assert_eq!(result.sanitized, "helloworld");
        assert!(result.changes.iter().any(|c| c.contains("null bytes")));
    }

    #[test]
    fn test_normalize_path_traversal() {
        let result = sanitize("../../etc/passwd");
        assert_eq!(result.sanitized, "etc/passwd");
        assert!(result.changes.iter().any(|c| c.contains("../")));
    }

    #[test]
    fn test_normalize_relative_paths() {
        let result = sanitize("./config/./test");
        assert_eq!(result.sanitized, "config/test");
        assert!(result.changes.iter().any(|c| c.contains("./"))); 
    }

    #[test]
    fn test_trim_whitespace() {
        let result = sanitize("hello    world");
        assert_eq!(result.sanitized, "hello world");
        assert!(result.changes.iter().any(|c| c.contains("whitespace")));
    }

    #[test]
    fn test_clean_input_unchanged() {
        let result = sanitize("hello world");
        assert_eq!(result.sanitized, "hello world");
        assert!(result.changes.is_empty());
    }

    #[test]
    fn test_multiple_sanitizations() {
        let result = sanitize("../../bin/sh; echo $(whoami)");
        assert!(!result.sanitized.contains("../"));
        assert!(!result.sanitized.contains(';'));
        assert!(!result.sanitized.contains('$'));
        assert!(!result.sanitized.contains('('));
        assert!(!result.sanitized.contains(')'));
    }
}
