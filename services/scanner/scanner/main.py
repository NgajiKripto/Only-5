"""FastAPI application for the security scanner service."""

from datetime import datetime, timezone

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from .models import (
    Finding,
    HealthResponse,
    ScanRequest,
    ScanResult,
    SeverityLevel,
    WorkflowInfo,
)
from .workflows import (
    HeaderScanWorkflow,
    PortScanWorkflow,
    SSLScanWorkflow,
    VulnScanWorkflow,
)

app = FastAPI(
    title="Security Scanner Service",
    description="FastAPI-based security scanning microservice",
    version="0.1.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

WORKFLOWS = {
    "port_scan": PortScanWorkflow,
    "header_scan": HeaderScanWorkflow,
    "ssl_scan": SSLScanWorkflow,
    "vuln_scan": VulnScanWorkflow,
}


def _calculate_score(findings: list[Finding]) -> float:
    """Calculate a security score (0-100) based on findings severity."""
    if not findings:
        return 100.0

    severity_weights = {
        SeverityLevel.INFO: 0,
        SeverityLevel.LOW: 5,
        SeverityLevel.MEDIUM: 15,
        SeverityLevel.HIGH: 30,
        SeverityLevel.CRITICAL: 50,
    }

    total_penalty = sum(severity_weights.get(f.severity, 0) for f in findings)
    return max(0.0, 100.0 - total_penalty)


def _generate_summary(findings: list[Finding], workflow_name: str) -> str:
    """Generate a human-readable summary of findings."""
    if not findings:
        return f"{workflow_name} completed with no issues found."

    counts = {}
    for f in findings:
        counts[f.severity.value] = counts.get(f.severity.value, 0) + 1

    parts = [f"{count} {sev}" for sev, count in sorted(counts.items())]
    return f"{workflow_name} found {len(findings)} issues: {', '.join(parts)}"


async def _run_workflow(workflow_name: str, target: str, params: dict) -> ScanResult:
    """Execute a single workflow and return a ScanResult."""
    if workflow_name not in WORKFLOWS:
        raise HTTPException(
            status_code=400,
            detail=f"Unknown workflow: {workflow_name}. Available: {list(WORKFLOWS.keys())}",
        )

    workflow_class = WORKFLOWS[workflow_name]
    workflow = workflow_class()

    result = await workflow.execute(target, params)

    # Generate findings from the workflow result
    findings: list[Finding] = []
    if result.success and result.data is not None:
        findings = _get_findings_from_workflow(workflow, result, target)

    return ScanResult(
        target=target,
        workflow=workflow_name,
        timestamp=datetime.now(timezone.utc).isoformat(),
        findings=findings,
        score=_calculate_score(findings),
        summary=_generate_summary(findings, workflow_name),
    )


def _get_findings_from_workflow(workflow, result, target: str) -> list[Finding]:
    """Extract findings from workflow result based on workflow type."""
    try:
        if isinstance(workflow, PortScanWorkflow):
            return workflow.generate_findings(result.data, target)
        elif isinstance(workflow, HeaderScanWorkflow):
            return workflow.generate_findings(result.data)
        elif isinstance(workflow, SSLScanWorkflow):
            return workflow.generate_findings(result.data)
        elif isinstance(workflow, VulnScanWorkflow):
            # The vuln scan has two steps, data comes from step results
            exposed_paths = {}
            disclosure = {}
            for step in result.steps:
                if step["name"] == "check_exposed_paths" and step["success"]:
                    exposed_paths = step["output"]
                elif step["name"] == "check_server_disclosure" and step["success"]:
                    disclosure = step["output"]
            return workflow.generate_findings(exposed_paths, disclosure)
    except Exception:
        return []
    return []


@app.get("/health", response_model=HealthResponse)
async def health():
    """Health check endpoint."""
    return HealthResponse(status="healthy", service="scanner", version="0.1.0")


@app.get("/workflows", response_model=list[WorkflowInfo])
async def list_workflows():
    """List available scanning workflows."""
    infos = []
    for name, cls in WORKFLOWS.items():
        workflow = cls()
        infos.append(
            WorkflowInfo(
                name=workflow.name(),
                description=workflow.description(),
                steps=len(workflow.steps()),
            )
        )
    return infos


@app.post("/scan", response_model=ScanResult)
async def scan(request: ScanRequest):
    """Run a single scan workflow on the target."""
    return await _run_workflow(request.workflow, request.target, request.params)


@app.post("/scan/full", response_model=list[ScanResult])
async def scan_full(request: ScanRequest):
    """Run all available workflows on the target."""
    results = []
    for workflow_name in WORKFLOWS:
        try:
            result = await _run_workflow(workflow_name, request.target, request.params)
            results.append(result)
        except HTTPException:
            continue
    return results
