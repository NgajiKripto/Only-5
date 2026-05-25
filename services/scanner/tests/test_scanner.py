"""Tests for the security scanner service."""

import asyncio
import ssl
from unittest.mock import AsyncMock, MagicMock, patch

import httpx
import pytest
from httpx import ASGITransport, AsyncClient

from scanner.main import app
from scanner.workflows.base import BaseWorkflow, StepResult
from scanner.workflows.header_scan import HeaderScanWorkflow
from scanner.workflows.port_scan import PortScanWorkflow
from scanner.workflows.ssl_scan import SSLScanWorkflow
from scanner.workflows.vuln_scan import VulnScanWorkflow


@pytest.fixture
def anyio_backend():
    return "asyncio"


@pytest.fixture
async def client():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac


@pytest.mark.asyncio
async def test_health_endpoint(client):
    """Test that health endpoint returns healthy status."""
    response = await client.get("/health")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "healthy"
    assert data["service"] == "scanner"
    assert data["version"] == "0.1.0"


@pytest.mark.asyncio
async def test_list_workflows(client):
    """Test that workflows endpoint lists all available workflows."""
    response = await client.get("/workflows")
    assert response.status_code == 200
    data = response.json()
    assert len(data) == 4
    names = [w["name"] for w in data]
    assert "port_scan" in names
    assert "header_scan" in names
    assert "ssl_scan" in names
    assert "vuln_scan" in names


@pytest.mark.asyncio
async def test_scan_unknown_workflow(client):
    """Test that scanning with unknown workflow returns 400."""
    response = await client.post(
        "/scan", json={"target": "example.com", "workflow": "nonexistent"}
    )
    assert response.status_code == 400


@pytest.mark.asyncio
async def test_port_scan_workflow():
    """Test port scan workflow with mocked socket connections."""
    workflow = PortScanWorkflow()

    async def mock_open_connection(host, port):
        writer = MagicMock()
        writer.close = MagicMock()
        writer.wait_closed = AsyncMock()
        if port in (80, 443, 22):
            return (MagicMock(), writer)
        raise ConnectionRefusedError()

    with patch("scanner.workflows.port_scan.asyncio.open_connection", side_effect=mock_open_connection):
        result = await workflow.execute("example.com")

    assert result.success is True
    assert 80 in result.data
    assert 443 in result.data
    assert 22 in result.data
    assert 3306 not in result.data


@pytest.mark.asyncio
async def test_port_scan_findings():
    """Test that port scan generates correct findings."""
    workflow = PortScanWorkflow()
    findings = workflow.generate_findings([80, 443, 3306, 6379], "example.com")

    assert len(findings) == 4

    # HTTP ports should be INFO
    http_findings = [f for f in findings if f.severity.value == "INFO"]
    assert len(http_findings) == 2

    # Database ports should be MEDIUM
    db_findings = [f for f in findings if f.severity.value == "MEDIUM"]
    assert len(db_findings) == 2


@pytest.mark.asyncio
async def test_header_scan_workflow():
    """Test header scan workflow with mocked HTTP responses."""
    workflow = HeaderScanWorkflow()

    mock_response = httpx.Response(
        200,
        headers={
            "content-type": "text/html",
            "x-frame-options": "DENY",
        },
        request=httpx.Request("GET", "https://example.com"),
    )

    with patch("scanner.workflows.header_scan.httpx.AsyncClient") as mock_client_cls:
        mock_client = AsyncMock()
        mock_client.get = AsyncMock(return_value=mock_response)
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=False)
        mock_client_cls.return_value = mock_client

        result = await workflow.execute("https://example.com")

    assert result.success is True
    assert isinstance(result.data, dict)


@pytest.mark.asyncio
async def test_header_scan_findings():
    """Test that missing security headers generate findings."""
    workflow = HeaderScanWorkflow()

    # Response with no security headers
    headers = {"content-type": "text/html"}
    findings = workflow.generate_findings(headers)

    # Should find all missing headers
    assert len(findings) == 6

    # Critical headers missing should be HIGH severity
    high_findings = [f for f in findings if f.severity.value == "HIGH"]
    assert len(high_findings) == 2  # CSP, HSTS

    # Optional headers missing should be LOW/MEDIUM
    low_findings = [f for f in findings if f.severity.value == "LOW"]
    assert len(low_findings) == 3  # X-Content-Type-Options, Referrer-Policy, Permissions-Policy


@pytest.mark.asyncio
async def test_header_scan_all_present():
    """Test that present security headers produce no findings."""
    workflow = HeaderScanWorkflow()

    headers = {
        "content-security-policy": "default-src 'self'",
        "strict-transport-security": "max-age=31536000",
        "x-frame-options": "DENY",
        "x-content-type-options": "nosniff",
        "referrer-policy": "strict-origin",
        "permissions-policy": "geolocation=()",
    }
    findings = workflow.generate_findings(headers)
    assert len(findings) == 0


@pytest.mark.asyncio
async def test_ssl_scan_workflow():
    """Test SSL scan workflow with mocked SSL connections."""
    workflow = SSLScanWorkflow()

    mock_ssl_info = {
        "subject": {"commonName": "example.com"},
        "issuer": {"commonName": "Let's Encrypt"},
        "not_before": "Jan  1 00:00:00 2024 GMT",
        "not_after": "Dec 31 23:59:59 2030 GMT",
        "protocol": "TLSv1.3",
        "cipher": "TLS_AES_256_GCM_SHA384",
        "cipher_bits": 256,
    }

    with patch.object(workflow, "_get_ssl_info", return_value=mock_ssl_info):
        result = await workflow.execute("example.com")

    assert result.success is True
    assert result.data["protocol"] == "TLSv1.3"


@pytest.mark.asyncio
async def test_ssl_scan_expired_cert():
    """Test SSL scan detects expired certificates."""
    workflow = SSLScanWorkflow()

    ssl_info = {
        "not_after": "Jan  1 00:00:00 2020 GMT",
        "protocol": "TLSv1.3",
        "cipher": "TLS_AES_256_GCM_SHA384",
        "cipher_bits": 256,
    }

    findings = workflow.generate_findings(ssl_info)
    assert any(f.severity.value == "CRITICAL" for f in findings)
    assert any("expired" in f.title.lower() for f in findings)


@pytest.mark.asyncio
async def test_ssl_scan_weak_protocol():
    """Test SSL scan detects weak protocols."""
    workflow = SSLScanWorkflow()

    ssl_info = {
        "not_after": "Dec 31 23:59:59 2030 GMT",
        "protocol": "TLSv1",
        "cipher": "AES128-SHA",
        "cipher_bits": 128,
    }

    findings = workflow.generate_findings(ssl_info)
    assert any("protocol" in f.title.lower() for f in findings)


@pytest.mark.asyncio
async def test_vuln_scan_workflow():
    """Test vulnerability scan with mocked HTTP responses."""
    workflow = VulnScanWorkflow()

    # Mock response for exposed paths
    mock_200 = httpx.Response(
        200,
        text="Admin Panel",
        request=httpx.Request("GET", "https://example.com/.env"),
    )
    mock_404 = httpx.Response(
        404,
        text="Not Found",
        request=httpx.Request("GET", "https://example.com/admin"),
    )

    call_count = 0

    async def mock_get(url, *args, **kwargs):
        nonlocal call_count
        call_count += 1
        if "/.env" in str(url):
            return mock_200
        if "/server-status" in str(url):
            return mock_200
        return mock_404

    with patch("scanner.workflows.vuln_scan.httpx.AsyncClient") as mock_client_cls:
        mock_client = AsyncMock()
        mock_client.get = AsyncMock(side_effect=mock_get)
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=False)
        mock_client_cls.return_value = mock_client

        result = await workflow.execute("https://example.com")

    assert result.success is True


@pytest.mark.asyncio
async def test_vuln_scan_findings():
    """Test vulnerability scan generates correct findings."""
    workflow = VulnScanWorkflow()

    exposed_paths = {
        "exposed_paths": [
            {"path": "/.env", "status": 200, "severity": "HIGH", "description": "Environment configuration file"},
            {"path": "/admin", "status": 200, "severity": "MEDIUM", "description": "Admin panel"},
        ]
    }
    disclosure = {
        "disclosure": {
            "server": "Apache/2.4.41",
            "directory_listing": True,
        }
    }

    findings = workflow.generate_findings(exposed_paths, disclosure)
    assert len(findings) == 4  # 2 paths + server disclosure + directory listing

    high_findings = [f for f in findings if f.severity.value == "HIGH"]
    assert len(high_findings) == 2  # .env path + directory listing


@pytest.mark.asyncio
async def test_command_validation_rejects_injection():
    """Test that command validation rejects shell injection patterns."""
    workflow = PortScanWorkflow()

    # Test semicolons
    result = workflow.validate_command("socket_connect", {"host": "example.com; rm -rf /"})
    assert result["valid"] is False
    assert "Blocked pattern" in result["error"]

    # Test backticks
    result = workflow.validate_command("socket_connect", {"cmd": "`whoami`"})
    assert result["valid"] is False

    # Test pipe
    result = workflow.validate_command("socket_connect", {"cmd": "ls | grep secret"})
    assert result["valid"] is False

    # Test $()
    result = workflow.validate_command("socket_connect", {"cmd": "$(cat /etc/passwd)"})
    assert result["valid"] is False

    # Test ${}
    result = workflow.validate_command("socket_connect", {"cmd": "${PATH}"})
    assert result["valid"] is False

    # Test &&
    result = workflow.validate_command("socket_connect", {"cmd": "echo test && rm -rf /"})
    assert result["valid"] is False


@pytest.mark.asyncio
async def test_command_validation_rejects_disallowed_tool():
    """Test that command validation rejects tools not in the whitelist."""
    workflow = PortScanWorkflow()

    result = workflow.validate_command("shell_exec", {"cmd": "ls"})
    assert result["valid"] is False
    assert "not in the allowed tools list" in result["error"]


@pytest.mark.asyncio
async def test_command_validation_accepts_valid():
    """Test that command validation accepts valid commands."""
    workflow = PortScanWorkflow()

    result = workflow.validate_command("socket_connect", {"host": "example.com", "port": "80"})
    assert result["valid"] is True


@pytest.mark.asyncio
async def test_full_scan_endpoint(client):
    """Test the full scan endpoint runs all workflows."""
    # Mock all workflow executions to avoid real network calls
    with patch.object(PortScanWorkflow, "execute_step") as mock_port, \
         patch.object(HeaderScanWorkflow, "execute_step") as mock_header, \
         patch.object(SSLScanWorkflow, "execute_step") as mock_ssl, \
         patch.object(VulnScanWorkflow, "execute_step") as mock_vuln:

        mock_port.return_value = StepResult(success=True, output=[80, 443], duration=0.1)
        mock_header.return_value = StepResult(success=True, output={"content-type": "text/html"}, duration=0.1)
        mock_ssl.return_value = StepResult(
            success=True,
            output={
                "protocol": "TLSv1.3",
                "cipher": "TLS_AES_256_GCM_SHA384",
                "cipher_bits": 256,
                "not_after": "Dec 31 23:59:59 2030 GMT",
            },
            duration=0.1,
        )
        mock_vuln.return_value = StepResult(
            success=True,
            output={"exposed_paths": [], "disclosure": {}},
            duration=0.1,
        )

        response = await client.post(
            "/scan/full",
            json={"target": "https://example.com", "workflow": "all"},
        )

    assert response.status_code == 200
    data = response.json()
    assert isinstance(data, list)
    assert len(data) == 4

    workflow_names = [r["workflow"] for r in data]
    assert "port_scan" in workflow_names
    assert "header_scan" in workflow_names
    assert "ssl_scan" in workflow_names
    assert "vuln_scan" in workflow_names
