"""Port scanning workflow - checks common ports using asyncio socket connections."""

import asyncio
import time

from ..models import Finding, SeverityLevel
from .base import BaseWorkflow, StepResult

COMMON_PORTS = [80, 443, 8080, 8443, 22, 21, 25, 3306, 5432, 6379, 27017]

DATABASE_PORTS = {3306, 5432, 6379, 27017}

PORT_SERVICES = {
    80: "HTTP",
    443: "HTTPS",
    8080: "HTTP-Alt",
    8443: "HTTPS-Alt",
    22: "SSH",
    21: "FTP",
    25: "SMTP",
    3306: "MySQL",
    5432: "PostgreSQL",
    6379: "Redis",
    27017: "MongoDB",
}


class PortScanWorkflow(BaseWorkflow):
    """Scans common ports on a target host using asyncio socket connections."""

    def name(self) -> str:
        return "port_scan"

    def description(self) -> str:
        return "Scan common ports on target host to identify open services"

    def steps(self) -> list[dict]:
        return [
            {
                "name": "scan_ports",
                "tool": "socket_connect",
                "params": {},
                "timeout_ms": 30000,
                "retries": 0,
                "parse_json": False,
            }
        ]

    def allowed_tools(self) -> list[str]:
        return ["socket_connect"]

    async def execute_step(self, step: dict, target: str, params: dict) -> StepResult:
        """Execute port scanning step."""
        start_time = time.time()

        # Strip protocol if present
        host = target
        for prefix in ("https://", "http://"):
            if host.startswith(prefix):
                host = host[len(prefix):]
        # Strip path and trailing slash
        host = host.split("/")[0]
        # Strip port if present
        host = host.split(":")[0]

        ports_to_scan = params.get("ports", COMMON_PORTS)
        timeout = params.get("timeout", 2.0)

        open_ports = await self._scan_ports(host, ports_to_scan, timeout)

        duration = time.time() - start_time
        return StepResult(success=True, output=open_ports, duration=duration)

    async def _scan_ports(
        self, host: str, ports: list[int], timeout: float
    ) -> list[int]:
        """Scan multiple ports concurrently."""
        tasks = [self._check_port(host, port, timeout) for port in ports]
        results = await asyncio.gather(*tasks)
        return [port for port, is_open in zip(ports, results) if is_open]

    async def _check_port(self, host: str, port: int, timeout: float) -> bool:
        """Check if a single port is open."""
        try:
            _, writer = await asyncio.wait_for(
                asyncio.open_connection(host, port), timeout=timeout
            )
            writer.close()
            await writer.wait_closed()
            return True
        except (asyncio.TimeoutError, OSError, ConnectionRefusedError):
            return False

    def generate_findings(self, open_ports: list[int], target: str) -> list[Finding]:
        """Generate findings from scan results."""
        findings: list[Finding] = []

        for port in open_ports:
            service = PORT_SERVICES.get(port, f"Unknown ({port})")
            is_db_port = port in DATABASE_PORTS

            severity = SeverityLevel.MEDIUM if is_db_port else SeverityLevel.INFO
            title = (
                f"Database port {port} ({service}) is open"
                if is_db_port
                else f"Port {port} ({service}) is open"
            )
            description = (
                f"Port {port} ({service}) is accessible on {target}. "
                + (
                    "Database ports exposed to the internet pose a security risk."
                    if is_db_port
                    else "This is an expected service port."
                )
            )
            recommendation = (
                f"Restrict access to port {port} using firewall rules or network segmentation."
                if is_db_port
                else None
            )

            findings.append(
                Finding(
                    type="open_port",
                    severity=severity,
                    title=title,
                    description=description,
                    evidence=f"Port {port} responded to connection attempt",
                    recommendation=recommendation,
                )
            )

        return findings
