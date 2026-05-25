"""Vulnerability detection workflow - checks for common misconfigurations."""

import time

import httpx

from ..models import Finding, SeverityLevel
from .base import BaseWorkflow, StepResult

SENSITIVE_PATHS = [
    ("/admin", SeverityLevel.MEDIUM, "Admin panel"),
    ("/wp-admin", SeverityLevel.MEDIUM, "WordPress admin panel"),
    ("/.env", SeverityLevel.HIGH, "Environment configuration file"),
    ("/phpinfo.php", SeverityLevel.HIGH, "PHP info page"),
    ("/server-status", SeverityLevel.MEDIUM, "Server status page"),
]


class VulnScanWorkflow(BaseWorkflow):
    """Checks for common vulnerability indicators and misconfigurations."""

    def name(self) -> str:
        return "vuln_scan"

    def description(self) -> str:
        return "Detect common vulnerabilities and misconfigurations"

    def steps(self) -> list[dict]:
        return [
            {
                "name": "check_exposed_paths",
                "tool": "http_get",
                "params": {},
                "timeout_ms": 30000,
                "retries": 0,
                "parse_json": False,
            },
            {
                "name": "check_server_disclosure",
                "tool": "http_get",
                "params": {},
                "timeout_ms": 10000,
                "retries": 0,
                "parse_json": False,
            },
        ]

    def allowed_tools(self) -> list[str]:
        return ["http_get"]

    async def execute_step(self, step: dict, target: str, params: dict) -> StepResult:
        """Execute vulnerability check step."""
        start_time = time.time()

        try:
            if step["name"] == "check_exposed_paths":
                result = await self._check_exposed_paths(target)
            elif step["name"] == "check_server_disclosure":
                result = await self._check_server_disclosure(target)
            else:
                result = {}

            duration = time.time() - start_time
            return StepResult(success=True, output=result, duration=duration)
        except Exception as exc:
            duration = time.time() - start_time
            return StepResult(success=False, output=str(exc), duration=duration)

    async def _check_exposed_paths(self, target: str) -> dict:
        """Check for exposed sensitive paths."""
        # Ensure target has a scheme
        url = target if target.startswith("http") else f"https://{target}"
        url = url.rstrip("/")

        exposed = []
        # NOTE: verify=True is the secure default. To scan self-signed targets,
        # this could be made configurable via a per-request parameter.
        async with httpx.AsyncClient(
            follow_redirects=False, timeout=5.0, verify=True
        ) as client:
            for path, severity, description in SENSITIVE_PATHS:
                try:
                    response = await client.get(f"{url}{path}")
                    if response.status_code == 200:
                        exposed.append(
                            {
                                "path": path,
                                "status": response.status_code,
                                "severity": severity.value,
                                "description": description,
                            }
                        )
                except (httpx.RequestError, httpx.TimeoutException):
                    continue

        return {"exposed_paths": exposed}

    async def _check_server_disclosure(self, target: str) -> dict:
        """Check for server version disclosure in headers."""
        url = target if target.startswith("http") else f"https://{target}"

        disclosure = {}
        # NOTE: verify=True is the secure default. To scan self-signed targets,
        # this could be made configurable via a per-request parameter.
        async with httpx.AsyncClient(
            follow_redirects=True, timeout=5.0, verify=True
        ) as client:
            try:
                response = await client.get(url)
                headers = response.headers

                if "server" in headers:
                    disclosure["server"] = headers["server"]
                if "x-powered-by" in headers:
                    disclosure["x_powered_by"] = headers["x-powered-by"]
                if "x-aspnet-version" in headers:
                    disclosure["aspnet_version"] = headers["x-aspnet-version"]

                # Check for directory listing
                body = response.text.lower()
                if "index of /" in body or "directory listing" in body:
                    disclosure["directory_listing"] = True

            except (httpx.RequestError, httpx.TimeoutException):
                pass

        return {"disclosure": disclosure}

    def generate_findings(
        self, exposed_paths: dict, disclosure: dict
    ) -> list[Finding]:
        """Generate findings from vulnerability checks."""
        findings: list[Finding] = []

        # Exposed paths
        for item in exposed_paths.get("exposed_paths", []):
            findings.append(
                Finding(
                    type="exposed_path",
                    severity=SeverityLevel(item["severity"]),
                    title=f"Exposed sensitive path: {item['path']}",
                    description=f"{item['description']} is accessible at {item['path']}",
                    evidence=f"HTTP {item['status']} response at {item['path']}",
                    recommendation=f"Restrict access to {item['path']} or remove it from production",
                )
            )

        # Server disclosure
        disc = disclosure.get("disclosure", {})
        if disc.get("server"):
            findings.append(
                Finding(
                    type="information_disclosure",
                    severity=SeverityLevel.MEDIUM,
                    title="Server version disclosed",
                    description="The server header reveals version information",
                    evidence=f"Server: {disc['server']}",
                    recommendation="Remove or obfuscate the Server header",
                )
            )

        if disc.get("x_powered_by"):
            findings.append(
                Finding(
                    type="information_disclosure",
                    severity=SeverityLevel.MEDIUM,
                    title="Technology stack disclosed via X-Powered-By",
                    description="The X-Powered-By header reveals technology information",
                    evidence=f"X-Powered-By: {disc['x_powered_by']}",
                    recommendation="Remove the X-Powered-By header",
                )
            )

        if disc.get("directory_listing"):
            findings.append(
                Finding(
                    type="directory_listing",
                    severity=SeverityLevel.HIGH,
                    title="Directory listing enabled",
                    description="The server has directory listing enabled, exposing file structure",
                    recommendation="Disable directory listing in the web server configuration",
                )
            )

        return findings
