use crate::models::Finding;

/// Pattern keywords that indicate findings in plain text output
const FINDING_PATTERNS: &[&str] = &["ERROR", "WARNING", "CRITICAL", "VULN"];

/// Parse output line by line, extracting structured findings
///
/// For each line:
/// - Try to parse as JSON; if it has "type", "finding", or "severity" fields, extract as Finding
/// - If not valid JSON, check for pattern keywords and create findings from matches
pub fn parse_json_lines(output: &str) -> Vec<Finding> {
    let mut findings = Vec::new();

    for (line_num, line) in output.lines().enumerate() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }

        // Try to parse as JSON
        if let Ok(value) = serde_json::from_str::<serde_json::Value>(trimmed) {
            if let Some(finding) = extract_finding_from_json(&value, line_num + 1) {
                findings.push(finding);
                continue;
            }
        }

        // Check for plain text patterns
        if let Some(finding) = extract_finding_from_text(trimmed, line_num + 1) {
            findings.push(finding);
        }
    }

    findings
}

/// Extract a finding from a JSON value if it contains relevant fields
fn extract_finding_from_json(value: &serde_json::Value, line: usize) -> Option<Finding> {
    let obj = value.as_object()?;

    // Check if it has "type", "finding", or "severity" fields
    let has_relevant_field = obj.contains_key("type")
        || obj.contains_key("finding")
        || obj.contains_key("severity");

    if !has_relevant_field {
        return None;
    }

    let finding_type = obj
        .get("type")
        .or_else(|| obj.get("severity"))
        .and_then(|v| v.as_str())
        .unwrap_or("info")
        .to_string();

    let content = obj
        .get("finding")
        .or_else(|| obj.get("message"))
        .or_else(|| obj.get("description"))
        .and_then(|v| v.as_str())
        .unwrap_or_else(|| value.to_string().leak())
        .to_string();

    Some(Finding {
        line,
        content,
        finding_type,
    })
}

/// Extract a finding from plain text if it matches known patterns
fn extract_finding_from_text(text: &str, line: usize) -> Option<Finding> {
    let upper = text.to_uppercase();

    for pattern in FINDING_PATTERNS {
        if upper.contains(pattern) {
            return Some(Finding {
                line,
                content: text.to_string(),
                finding_type: pattern.to_lowercase(),
            });
        }
    }

    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_json_with_type() {
        let output = r#"{"type": "vulnerability", "finding": "SQL injection detected"}"#;
        let findings = parse_json_lines(output);
        assert_eq!(findings.len(), 1);
        assert_eq!(findings[0].finding_type, "vulnerability");
        assert_eq!(findings[0].content, "SQL injection detected");
    }

    #[test]
    fn test_parse_json_with_severity() {
        let output = r#"{"severity": "high", "message": "Open port 22"}"#;
        let findings = parse_json_lines(output);
        assert_eq!(findings.len(), 1);
        assert_eq!(findings[0].finding_type, "high");
        assert_eq!(findings[0].content, "Open port 22");
    }

    #[test]
    fn test_parse_plain_text_error() {
        let output = "ERROR: Connection refused on port 443";
        let findings = parse_json_lines(output);
        assert_eq!(findings.len(), 1);
        assert_eq!(findings[0].finding_type, "error");
        assert!(findings[0].content.contains("Connection refused"));
    }

    #[test]
    fn test_parse_plain_text_warning() {
        let output = "WARNING: SSL certificate expires in 7 days";
        let findings = parse_json_lines(output);
        assert_eq!(findings.len(), 1);
        assert_eq!(findings[0].finding_type, "warning");
    }

    #[test]
    fn test_parse_mixed_output() {
        let output = r#"Starting scan...
{"type": "info", "finding": "Port 80 open"}
Normal log line
WARNING: Weak cipher detected
{"type": "critical", "finding": "RCE vulnerability"}
Done."#;
        let findings = parse_json_lines(output);
        assert_eq!(findings.len(), 3);
    }

    #[test]
    fn test_parse_malformed_json() {
        let output = r#"{"broken json: missing bracket
normal text
{"valid": "json", "but": "no relevant fields"}
WARNING: something bad"#;
        let findings = parse_json_lines(output);
        assert_eq!(findings.len(), 1);
        assert_eq!(findings[0].finding_type, "warning");
    }

    #[test]
    fn test_parse_empty_output() {
        let findings = parse_json_lines("");
        assert!(findings.is_empty());
    }

    #[test]
    fn test_parse_whitespace_only() {
        let findings = parse_json_lines("   \n  \n   ");
        assert!(findings.is_empty());
    }
}
