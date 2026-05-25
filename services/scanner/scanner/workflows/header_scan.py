"""HTTP header analysis workflow - checks for security headers."""

import time

import httpx

from ..models import Finding, SeverityLevel
from .base import BaseWorkflow, StepResult

CRITICAL_HEADERS = {
    "content-security-policy": {
        "severity": SeverityLevel.HIGH,
        "description": "Content-Security-Policy prevents XSS and data injection attacks",
        "recommendation": "Add a Content-Security-Policy header with appropriate directives",
    },
    "strict-transport-security": {
        "severity": SeverityLevel.HIGH,
        "description": "Strict-Transport-Security enforces HTTPS connections",
        "recommendation": "Add Strict-Transport-Security header with max-age of at least 31536000",
    },
    "x-frame-options": {
        "severity": SeverityLevel.MEDIUM,
        "description": "X-Frame-Options prevents clickjacking attacks",
        "recommendation": "Add X-Frame-Options header set to DENY or SAMEORIGIN",
    },
}

OPTIONAL_HEADERS = {
    "x-content-type-options": {
        "severity": SeverityLevel.LOW,
        "description": "X-Content-Type-Options prevents MIME type sniffing",
        "recommendation": "Add X-Content-Type-Options header set to nosniff",
    },
    "referrer-policy": {
        "severity": SeverityLevel.LOW,
        "description": "Referrer-Policy controls referrer information sent with requests",
        "recommendation": "Add Referrer-Policy header (e.g., strict-origin-when-cross-origin)",
    },
    "permissions-policy": {
        "severity": SeverityLevel.LOW,
        "description": "Permissions-Policy controls browser feature access",
        "recommendation": "Add Permissions-Policy header to restrict unnecessary browser features",
    },
}


class HeaderScanWorkflow(BaseWorkflow):
    """Fetches target URL headers and checks for security headers."""

    def name(self) -> str:
        return "header_scan"

    def description(self) -> str:
        return "Analyze HTTP response headers for security best practices"

    def steps(self) -> list[dict]:
        return [
            {
                "name": "fetch_headers",
                "tool": "http_get",
                "params": {},
                "timeout_ms": 15000,
                "retries": 1,
                "parse_json": False,
            }
        ]

    def allowed_tools(self) -> list[str]:
        return ["http_get"]

    async def execute_step(self, step: dict, target: str, params: dict) -> StepResult:
        """Fetch headers from target URL."""
        start_time = time.time()

        try:
            async with httpx.AsyncClient(
                follow_redirects=True, timeout=10.0, verify=False
            ) as client:
                response = await client.get(target)
                headers = dict(response.headers)
                duration = time.time() - start_time
                return StepResult(success=True, output=headers, duration=duration)
        except Exception as exc:
            duration = time.time() - start_time
            return StepResult(success=False, output=str(exc), duration=duration)

    def generate_findings(self, headers: dict[str, str]) -> list[Finding]:
        """Generate findings from header analysis."""
        findings: list[Finding] = []
        lower_headers = {k.lower(): v for k, v in headers.items()}

        all_checks = {**CRITICAL_HEADERS, **OPTIONAL_HEADERS}

        for header_name, info in all_checks.items():
            if header_name not in lower_headers:
                findings.append(
                    Finding(
                        type="missing_header",
                        severity=info["severity"],
                        title=f"Missing security header: {header_name}",
                        description=info["description"],
                        recommendation=info["recommendation"],
                    )
                )

        return findings
