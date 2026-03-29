"""Agent failure handling for the three required failure modes.

1. Tool timeout — retry once, then skip with partial data
2. Invalid tool output — retry with simplified prompt, then proceed with partial data
3. Low confidence — gather more signal before accepting

These handlers are called by the agent's execute_tools node and routing logic.
"""

from __future__ import annotations

import json
from concurrent.futures import ThreadPoolExecutor, TimeoutError as FuturesTimeout
from typing import Any, Callable

import structlog

from app.config import settings
from app.models.schemas import JobRequirements, ScoringResult

logger = structlog.get_logger()

TOOL_TIMEOUT_MS = settings.tool_timeout_seconds * 1000


# --- Mode 1: Tool Timeout ---

def with_timeout(func: Callable, args: dict, timeout_ms: int = TOOL_TIMEOUT_MS) -> Any:
    """Execute a tool call with timeout protection using concurrent.futures.

    Strategy: Submit to a thread pool with a deadline. If the tool exceeds
    the timeout, cancel and raise TimeoutError so the caller can retry or skip.
    Uses concurrent.futures for clean resource management (no orphan threads).
    """
    timeout_s = timeout_ms / 1000
    with ThreadPoolExecutor(max_workers=1) as executor:
        future = executor.submit(func, args)
        try:
            return future.result(timeout=timeout_s)
        except FuturesTimeout:
            future.cancel()
            logger.warning("tool_timeout", timeout_ms=timeout_ms)
            raise TimeoutError(f"Tool timed out after {timeout_ms}ms")


# --- Mode 2: Invalid Tool Output ---

def validate_or_retry_extraction(raw_output: Any) -> dict[str, Any] | None:
    """Validate JD extraction output. Returns validated dict or None if unsalvageable.

    Strategy:
    - Try full Pydantic validation
    - If malformed, attempt partial recovery from available fields
    - Returns None only if completely unsalvageable
    """
    try:
        if isinstance(raw_output, str):
            raw_output = json.loads(raw_output)
        validated = JobRequirements(**raw_output)
        return validated.model_dump()
    except Exception as e:
        logger.warning("extraction_validation_failed", error=str(e))

    # Attempt partial recovery
    try:
        if isinstance(raw_output, dict):
            partial = {
                "required_skills": raw_output.get("required_skills", []),
                "nice_to_have_skills": raw_output.get("nice_to_have_skills", []),
                "seniority_level": raw_output.get("seniority_level", "mid"),
                "domain": raw_output.get("domain", "unknown"),
                "responsibilities": raw_output.get("responsibilities", []),
            }
            validated = JobRequirements(**partial)
            logger.info("extraction_partial_recovery", num_skills=len(validated.required_skills))
            return validated.model_dump()
    except Exception:
        pass

    return None


def validate_or_retry_scoring(raw_output: Any) -> dict[str, Any] | None:
    """Validate scoring output. Returns validated dict or None."""
    try:
        if isinstance(raw_output, str):
            raw_output = json.loads(raw_output)
        validated = ScoringResult(**raw_output)
        return validated.model_dump()
    except Exception as e:
        logger.warning("scoring_validation_failed", error=str(e))
        return None


# --- Mode 3: Low Confidence ---

def handle_low_confidence(
    scoring_result: dict[str, Any],
    requirements: dict[str, Any],
    candidate_profile: dict[str, Any],
) -> str:
    """Analyze why confidence is low and return guidance for the agent.

    Strategy:
    - Diagnose the cause (sparse JD, low skill overlap, domain mismatch)
    - Return a guidance string injected into the agent's next reasoning step
    - The agent can then re-extract, re-score with context, or accept with reasoning
    """
    confidence = scoring_result.get("confidence", "medium")
    if confidence != "low":
        return ""

    matched = scoring_result.get("matched_skills", [])
    gaps = scoring_result.get("gap_skills", [])
    required = requirements.get("required_skills", [])

    reasons = []

    # Check JD completeness
    if len(required) < 3:
        reasons.append(
            "The job description has very few required skills listed — "
            "try re-extracting with more detail or ask for a more complete JD."
        )

    # Check match ratio
    match_ratio = len(matched) / max(len(required), 1)
    if match_ratio < 0.4:
        reasons.append(
            f"Only {len(matched)}/{len(required)} required skills matched "
            f"({match_ratio:.0%}). The candidate may be a poor fit, "
            f"or skills might be described differently."
        )

    # Check domain distance
    candidate_skills = {s.lower() for s in candidate_profile.get("skills", [])}
    required_skills = {s.lower() for s in required}
    if not candidate_skills & required_skills:
        reasons.append(
            "Zero exact skill overlap detected. The candidate and job may be in "
            "very different domains."
        )

    guidance = (
        "LOW CONFIDENCE detected. Reasons:\n"
        + "\n".join(f"- {r}" for r in reasons)
        + "\n\nThe agent should either: (a) re-extract the JD with more detail, "
        "(b) re-score with additional context about equivalent skills, or "
        "(c) accept the low-confidence result with explicit reasoning."
    )

    logger.info("low_confidence_handler", reasons=len(reasons), match_ratio=match_ratio)
    return guidance
