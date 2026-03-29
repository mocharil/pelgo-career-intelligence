"""Tool 1: extract_jd_requirements — Extract structured requirements from a job description."""

from __future__ import annotations

import hashlib
import time
from typing import Any

import httpx
import structlog
from bs4 import BeautifulSoup
from langchain_core.tools import tool

from app.config import settings
from app.models.schemas import JobRequirements
from app.utils import call_llm_json, validate_url

logger = structlog.get_logger()

# In-memory cache keyed by content hash
_extraction_cache: dict[str, dict[str, Any]] = {}


def _fetch_url_content(url: str, timeout: int = 30) -> str:
    """Fetch and parse text content from a URL (with SSRF protection)."""
    validate_url(url)
    response = httpx.get(url, timeout=timeout, follow_redirects=True, headers={
        "User-Agent": "Mozilla/5.0 (compatible; PelgoBot/1.0)"
    })
    response.raise_for_status()
    soup = BeautifulSoup(response.text, "lxml")

    for tag in soup(["script", "style", "nav", "footer", "header"]):
        tag.decompose()

    return soup.get_text(separator="\n", strip=True)


def _content_hash(text: str) -> str:
    return hashlib.sha256(text.encode()).hexdigest()[:16]


EXTRACT_PROMPT = """You are a job description parser. Extract structured information from the following job description.

Return a JSON object with exactly these fields:
- "required_skills": list of strings — hard skills explicitly required
- "nice_to_have_skills": list of strings — skills listed as preferred/nice-to-have/bonus
- "seniority_level": one of "intern", "junior", "mid", "senior", "staff", "lead", "principal", "director"
- "domain": string — the industry/domain (e.g., "fintech", "healthcare", "e-commerce")
- "responsibilities": list of strings — key responsibilities
- "company_name": string — the company name if mentioned (or "Unknown")
- "job_title": string — the exact job title if mentioned (or "Unknown")

SKILL EXTRACTION RULES:
- Extract skills at the CANONICAL level, not overly specific variants
- Use standard industry names: "Excel" not "Excel modeling", "SQL" not "SQL querying"
- If the JD says "Excel modeling", extract as "Excel" (the tool, not the sub-skill)
- If the JD says "Google Sheets" or "GSheets", extract as "Google Sheets"
- Do NOT create redundant entries like both "Excel" and "Excel formulas" — just "Excel"
- Do NOT split one skill into sub-skills (e.g., "data visualization" not "Tableau visualization" + "dashboard creation")
- Keep tool names as-is: "Metabase", "Tableau", "Power BI", "Looker" — these are distinct tools

Be precise. Infer seniority from title, years required, and responsibilities.

Job Description:
{jd_text}

Return ONLY valid JSON, no markdown fences."""


@tool
def extract_jd_requirements(job_url_or_text: str) -> dict[str, Any]:
    """Extract structured requirements from a job description (text or URL).

    Args:
        job_url_or_text: Either raw JD text or a URL to fetch the JD from.

    Returns:
        Structured requirements: required_skills, nice_to_have_skills,
        seniority_level, domain, responsibilities.
    """
    start = time.time()

    # Determine if input is URL or text
    jd_text = job_url_or_text
    if job_url_or_text.startswith(("http://", "https://")):
        logger.info("extract_jd_fetching_url", url=job_url_or_text)
        jd_text = _fetch_url_content(job_url_or_text, timeout=settings.tool_timeout_seconds)

    # Check cache
    cache_key = _content_hash(jd_text)
    if cache_key in _extraction_cache:
        logger.info("extract_jd_cache_hit", cache_key=cache_key)
        return _extraction_cache[cache_key]

    # Call Gemini, parse, validate
    result = call_llm_json(
        EXTRACT_PROMPT.format(jd_text=jd_text),
        JobRequirements,
        max_tokens=2000,
    )

    # Cache it
    _extraction_cache[cache_key] = result

    latency = int((time.time() - start) * 1000)
    logger.info("extract_jd_success", latency_ms=latency, num_skills=len(result["required_skills"]))

    return result
