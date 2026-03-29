"""Tool 4: prioritise_skill_gaps — Rank skill gaps by impact and market demand."""

from __future__ import annotations

import json
import time
from typing import Any

import structlog
from langchain_core.tools import tool

from app.models.schemas import PrioritisedSkill
from app.utils import strip_markdown_json

logger = structlog.get_logger()

PRIORITISE_PROMPT = """You are a career advisor. Rank these skill gaps by priority for a candidate to learn.

GAP SKILLS: {gap_skills}

JOB MARKET CONTEXT: {job_market_context}

Consider:
1. How much would learning this skill improve the candidate's match score?
2. How in-demand is this skill in the current job market?
3. How much effort is required to learn it (prefer high-impact, lower-effort skills first)?
4. Are there skills that are prerequisites for others?

Return a JSON array of objects, each with:
- "skill": the skill name
- "priority_rank": integer starting from 1 (1 = highest priority)
- "estimated_match_gain_pct": estimated percentage points the overall match score would increase if this skill is acquired (1-20)
- "rationale": one sentence explaining why this priority

Rank by IMPACT, not alphabetically. Return ONLY valid JSON array, no markdown fences."""


@tool
def prioritise_skill_gaps(
    gap_skills: list[str],
    job_market_context: str,
) -> list[dict[str, Any]]:
    """Prioritise skill gaps by market demand and impact on match score.

    Args:
        gap_skills: List of skills the candidate is missing.
        job_market_context: Context about the job domain and market.

    Returns:
        Ranked list of prioritised skills with rationale.
    """
    from app.llm import call_gemini

    start = time.time()

    if not gap_skills:
        return []

    raw_text = call_gemini(
        PRIORITISE_PROMPT.format(
            gap_skills=json.dumps(gap_skills),
            job_market_context=job_market_context,
        ),
        max_tokens=1500,
    )

    raw_text = strip_markdown_json(raw_text)
    parsed = json.loads(raw_text)

    # Validate each entry
    validated = [PrioritisedSkill(**item).model_dump() for item in parsed]

    # Ensure ranks are sequential
    validated.sort(key=lambda x: x["priority_rank"])
    for i, item in enumerate(validated):
        item["priority_rank"] = i + 1

    latency = int((time.time() - start) * 1000)
    logger.info("prioritise_gaps_success", latency_ms=latency, num_gaps=len(validated))

    return validated
