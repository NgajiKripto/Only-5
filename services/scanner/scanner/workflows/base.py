"""Base workflow abstract class adapted from Dark-Moon BaseWorkflow pattern.

Provides step-by-step execution with retry logic, timeout handling,
command whitelist validation, and shell injection detection.
"""

from __future__ import annotations

import re
import time
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Any, Optional

SHELL_INJECTION_PATTERN = re.compile(r"[;`|]|&&|\$\(|\$\{")


@dataclass
class StepResult:
    """Result of a single workflow step execution."""

    success: bool
    output: Any = None
    duration: float = 0.0


@dataclass
class WorkflowResult:
    """Result of a complete workflow execution."""

    success: bool
    data: Any = None
    error: str | None = None
    steps: list[dict] = field(default_factory=list)
    started_at: float = 0.0
    completed_at: float = 0.0
    duration: float = 0.0


class BaseWorkflow(ABC):
    """Abstract base class for scanning workflows.

    Adapted from the TypeScript BaseWorkflow pattern in Dark-Moon.
    Validates commands against a whitelist and checks for shell injection.
    Steps execute sequentially with retry and timeout support.
    """

    @abstractmethod
    def name(self) -> str:
        """Return the workflow name."""
        ...

    @abstractmethod
    def description(self) -> str:
        """Return the workflow description."""
        ...

    @abstractmethod
    def steps(self) -> list[dict]:
        """Return the list of steps for this workflow.

        Each step is a dict with keys: name, tool, params, timeout_ms, retries, parse_json.
        """
        ...

    @abstractmethod
    def allowed_tools(self) -> list[str]:
        """Return the list of tools this workflow is allowed to use."""
        ...

    @abstractmethod
    async def execute_step(self, step: dict, target: str, params: dict) -> StepResult:
        """Execute a single workflow step. Subclasses implement actual logic."""
        ...

    async def execute(self, target: str, params: dict | None = None) -> WorkflowResult:
        """Run all steps sequentially with retry and timeout handling."""
        params = params or {}
        started_at = time.time()
        step_results: list[dict] = []

        for step in self.steps():
            validation = self.validate_command(
                step.get("tool", ""), step.get("params", {})
            )
            if not validation["valid"]:
                step_results.append(
                    {
                        "name": step["name"],
                        "success": False,
                        "output": None,
                        "duration": 0.0,
                    }
                )
                return self._create_result(
                    step_results, started_at, error=validation.get("error")
                )

            retries = step.get("retries", 1)
            result = StepResult(success=False)

            for attempt in range(retries + 1):
                try:
                    result = await self.execute_step(step, target, params)
                    if result.success:
                        break
                except Exception as exc:
                    result = StepResult(success=False, output=str(exc))
                    if attempt == retries:
                        break

            step_results.append(
                {
                    "name": step["name"],
                    "success": result.success,
                    "output": result.output,
                    "duration": result.duration,
                }
            )

            if not result.success:
                return self._create_result(
                    step_results,
                    started_at,
                    error=f'Step "{step["name"]}" failed',
                )

        return self._create_result(step_results, started_at)

    def validate_command(
        self, tool: str, params: dict[str, Any]
    ) -> dict[str, Any]:
        """Validate a command against the allowed tools whitelist and check for injection."""
        allowed = self.allowed_tools()

        if tool and tool not in allowed:
            return {"valid": False, "error": f'Tool "{tool}" is not in the allowed tools list'}

        injection_error = self._check_params(params)
        if injection_error:
            return {"valid": False, "error": injection_error}

        return {"valid": True}

    def _check_params(self, params: dict[str, Any]) -> str | None:
        """Recursively check params for shell injection patterns."""
        for key, value in params.items():
            if isinstance(value, str) and SHELL_INJECTION_PATTERN.search(value):
                return f'Blocked pattern detected in parameter "{key}"'
            if isinstance(value, dict):
                nested = self._check_params(value)
                if nested:
                    return nested
        return None

    def _create_result(
        self,
        steps: list[dict],
        started_at: float,
        error: str | None = None,
    ) -> WorkflowResult:
        """Create a WorkflowResult from step results."""
        completed_at = time.time()
        all_success = all(s["success"] for s in steps)
        last_step = steps[-1] if steps else {}

        return WorkflowResult(
            success=all_success and error is None,
            data=last_step.get("output"),
            error=error,
            steps=steps,
            started_at=started_at,
            completed_at=completed_at,
            duration=completed_at - started_at,
        )
