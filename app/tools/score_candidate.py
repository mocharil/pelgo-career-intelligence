"""Tool 2: score_candidate_against_requirements — Multi-dimension scoring with confidence."""

from __future__ import annotations

import json
import time
from typing import Any

import structlog
from langchain_core.tools import tool

from app.models.schemas import ScoringResult
from app.utils import call_llm_json

logger = structlog.get_logger()

SCORING_PROMPT = """You are a career-matching expert. Score how well this candidate matches the job requirements.

CANDIDATE PROFILE:
{candidate_json}

JOB REQUIREMENTS:
{requirements_json}

Evaluate across three dimensions:
1. **Skills** (0-100): What percentage of required skills does the candidate have?
2. **Experience** (0-100): Does the candidate's years and type of experience align with the role?
3. **Seniority Fit** (0-100): Does the candidate's career level match the role's seniority?

CRITICAL SKILL MATCHING RULES:
A skill is MATCHED if the candidate has the same skill OR any equivalent/subset/superset. Examples:
- "Excel" covers "Excel modeling", "Excel advanced", "Excel formulas", "spreadsheet modeling"
- "React" = "React.js" = "ReactJS"
- "Python" covers "Python scripting", "data programming languages" (if Python is a data programming language)
- "SQL" covers "MySQL", "PostgreSQL", "database querying"
- "data visualization" covers "Tableau", "Power BI", "Metabase", "Looker" (and vice versa)
- "GSheets" = "Google Sheets" = "spreadsheets" (also covered if candidate has "Excel")
- "AWS" covers "cloud computing", "cloud infrastructure"
- "CI/CD" covers "Jenkins", "GitHub Actions", "GitLab CI"
- A general skill matches its specific variants and vice versa

If the candidate has a BROADER skill that encompasses the required skill, it is a MATCH.
If the candidate has a SPECIFIC variant of the required general skill, it is a MATCH.
Only mark as a gap if the candidate genuinely lacks the skill AND any reasonable equivalent.

A skill should NEVER appear in BOTH matched_skills and gap_skills.

Return a JSON object with:
- "overall_score": 0-100 (weighted: skills 50%, experience 30%, seniority_fit 20%)
- "dimension_scores": {{"skills": 0-100, "experience": 0-100, "seniority_fit": 0-100}}
- "matched_skills": list of required skills the candidate has (use the JD's wording, include equivalent matches)
- "gap_skills": list of required skills the candidate genuinely lacks (no equivalents found)
- "confidence": "low", "medium", or "high"

Confidence rules:
- "high": >=70% required skills clearly matched AND JD has >=5 required skills AND candidate domain overlaps
- "medium": 40-70% skills matched OR JD has 3-4 required skills
- "low": <40% matched OR JD has <3 required skills OR candidate domain is very different from JD domain

Return ONLY valid JSON, no markdown fences."""


@tool
def score_candidate_against_requirements(
    candidate_profile: dict[str, Any],
    requirements: dict[str, Any],
) -> dict[str, Any]:
    """Score a candidate against job requirements with multi-dimensional analysis.

    Args:
        candidate_profile: The candidate's structured profile.
        requirements: Structured job requirements from extract_jd_requirements.

    Returns:
        Scoring result with overall_score, dimension_scores, matched/gap skills,
        and confidence level.
    """
    start = time.time()

    result = call_llm_json(
        SCORING_PROMPT.format(
            candidate_json=json.dumps(candidate_profile, indent=2),
            requirements_json=json.dumps(requirements, indent=2),
        ),
        ScoringResult,
        max_tokens=2000,
    )

    latency = int((time.time() - start) * 1000)
    logger.info(
        "score_candidate_success",
        latency_ms=latency,
        overall_score=result["overall_score"],
        confidence=result["confidence"],
    )

    return result
