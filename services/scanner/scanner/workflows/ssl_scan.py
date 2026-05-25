"""SSL/TLS certificate analysis workflow."""

import ssl
import socket
import time
from datetime import datetime, timezone

from ..models import Finding, SeverityLevel
from .base import BaseWorkflow, StepResult


class SSLScanWorkflow(BaseWorkflow):
    """Connects to target with SSL and checks certificate properties."""

    def name(self) -> str:
        return "ssl_scan"

    def description(self) -> str:
        return "Analyze SSL/TLS certificate and connection security"

    def steps(self) -> list[dict]:
        return [
            {
                "name": "check_ssl",
                "tool": "ssl_connect",
                "params": {},
                "timeout_ms": 15000,
                "retries": 1,
                "parse_json": False,
            }
        ]

    def allowed_tools(self) -> list[str]:
        return ["ssl_connect"]

    async def execute_step(self, step: dict, target: str, params: dict) -> StepResult:
        """Check SSL/TLS certificate on target."""
        start_time = time.time()

        # Strip protocol and path
        host = target
        for prefix in ("https://", "http://"):
            if host.startswith(prefix):
                host = host[len(prefix):]
        host = host.split("/")[0]

        # Handle port
        port = 443
        if ":" in host:
            parts = host.split(":")
            host = parts[0]
            port = int(parts[1])

        try:
            ssl_info = self._get_ssl_info(host, port)
            duration = time.time() - start_time
            return StepResult(success=True, output=ssl_info, duration=duration)
        except Exception as exc:
            duration = time.time() - start_time
            return StepResult(success=False, output=str(exc), duration=duration)

    def _get_ssl_info(self, host: str, port: int) -> dict:
        """Get SSL certificate information."""
        context = ssl.create_default_context()
        with socket.create_connection((host, port), timeout=10) as sock:
            with context.wrap_socket(sock, server_hostname=host) as ssock:
                cert = ssock.getpeercert()
                cipher = ssock.cipher()
                protocol = ssock.version()

                not_after = cert.get("notAfter", "")
                not_before = cert.get("notBefore", "")
                subject = dict(x[0] for x in cert.get("subject", []))
                issuer = dict(x[0] for x in cert.get("issuer", []))

                return {
                    "subject": subject,
                    "issuer": issuer,
                    "not_before": not_before,
                    "not_after": not_after,
                    "protocol": protocol,
                    "cipher": cipher[0] if cipher else None,
                    "cipher_bits": cipher[2] if cipher else None,
                }

    def generate_findings(self, ssl_info: dict) -> list[Finding]:
        """Generate findings from SSL analysis."""
        findings: list[Finding] = []

        # Check certificate expiry
        not_after = ssl_info.get("not_after")
        if not_after:
            try:
                expiry = datetime.strptime(not_after, "%b %d %H:%M:%S %Y %Z")
                expiry = expiry.replace(tzinfo=timezone.utc)
                now = datetime.now(timezone.utc)
                days_left = (expiry - now).days

                if days_left < 0:
                    findings.append(
                        Finding(
                            type="ssl_expiry",
                            severity=SeverityLevel.CRITICAL,
                            title="SSL certificate has expired",
                            description=f"Certificate expired {abs(days_left)} days ago",
                            evidence=f"Expiry date: {not_after}",
                            recommendation="Renew the SSL certificate immediately",
                        )
                    )
                elif days_left < 30:
                    findings.append(
                        Finding(
                            type="ssl_expiry",
                            severity=SeverityLevel.HIGH,
                            title="SSL certificate expiring soon",
                            description=f"Certificate expires in {days_left} days",
                            evidence=f"Expiry date: {not_after}",
                            recommendation="Renew the SSL certificate before it expires",
                        )
                    )
            except (ValueError, TypeError):
                pass

        # Check protocol version
        protocol = ssl_info.get("protocol", "")
        weak_protocols = ["SSLv2", "SSLv3", "TLSv1", "TLSv1.1"]
        if protocol in weak_protocols:
            findings.append(
                Finding(
                    type="weak_protocol",
                    severity=SeverityLevel.HIGH,
                    title=f"Weak SSL/TLS protocol: {protocol}",
                    description=f"Server supports {protocol} which is considered insecure",
                    evidence=f"Negotiated protocol: {protocol}",
                    recommendation="Disable weak protocols and use TLSv1.2 or TLSv1.3",
                )
            )

        # Check cipher strength
        cipher_bits = ssl_info.get("cipher_bits")
        if cipher_bits and cipher_bits < 128:
            findings.append(
                Finding(
                    type="weak_cipher",
                    severity=SeverityLevel.HIGH,
                    title="Weak cipher strength detected",
                    description=f"Cipher uses only {cipher_bits} bits which is below recommended minimum",
                    evidence=f"Cipher: {ssl_info.get('cipher')} ({cipher_bits} bits)",
                    recommendation="Configure the server to use ciphers with at least 128-bit strength",
                )
            )

        return findings
