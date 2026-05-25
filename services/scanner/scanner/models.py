"""Pydantic models for the security scanner service."""

from datetime import datetime
from enum import Enum
from typing import Optional

from pydantic import BaseModel, Field


class SeverityLevel(str, Enum):
    """Severity levels for scan findings."""

    INFO = "INFO"
    LOW = "LOW"
    MEDIUM = "MEDIUM"
    HIGH = "HIGH"
    CRITICAL = "CRITICAL"


class Finding(BaseModel):
    """A single finding from a scan."""

    type: str
    severity: SeverityLevel
    title: str
    description: str
    evidence: Optional[str] = None
    recommendation: Optional[str] = None


class ScanRequest(BaseModel):
    """Request to run a scan workflow."""

    target: str
    workflow: str
    params: dict = Field(default_factory=dict)


class ScanResult(BaseModel):
    """Result of a scan workflow execution."""

    target: str
    workflow: str
    timestamp: str
    findings: list[Finding]
    score: float
    summary: str


class WorkflowInfo(BaseModel):
    """Information about an available workflow."""

    name: str
    description: str
    steps: int


class HealthResponse(BaseModel):
    """Health check response."""

    status: str
    service: str
    version: str
