"""Tool 3: research_skill_resources — Find learning resources via real external API calls."""

from __future__ import annotations

import json
import time
import urllib.parse
from typing import Any

import httpx
import structlog
from langchain_core.tools import tool

from app.models.schemas import SkillResourceResult
from app.utils import call_llm_json

logger = structlog.get_logger()

# Cache by (skill, seniority)
_resource_cache: dict[str, dict[str, Any]] = {}


def _search_duckduckgo(query: str) -> list[dict[str, Any]]:
    """Search using DuckDuckGo HTML (free, no key required)."""
    try:
        response = httpx.get(
            "https://html.duckduckgo.com/html/",
            params={"q": query},
            headers={
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            },
            timeout=10,
            follow_redirects=True,
        )
        response.raise_for_status()

        from bs4 import BeautifulSoup
        soup = BeautifulSoup(response.text, "lxml")
        results = []

        for result_div in soup.select(".result__body")[:8]:
            title_el = result_div.select_one(".result__a")
            snippet_el = result_div.select_one(".result__snippet")
            if title_el and title_el.get("href"):
                href = title_el["href"]
                if "uddg=" in href:
                    parsed = urllib.parse.parse_qs(urllib.parse.urlparse(href).query)
                    href = parsed.get("uddg", [href])[0]
                results.append({
                    "title": title_el.get_text(strip=True)[:150],
                    "link": href,
                    "snippet": snippet_el.get_text(strip=True)[:300] if snippet_el else "",
                })

        return results
    except Exception as e:
        logger.warning("duckduckgo_search_failed", error=str(e))
        return []


def _search_github_topics(skill: str) -> list[dict[str, Any]]:
    """Search GitHub for awesome-lists and learning repos (real external call, no key)."""
    try:
        response = httpx.get(
            "https://api.github.com/search/repositories",
            params={"q": f"awesome {skill} learning", "sort": "stars", "per_page": 5},
            headers={"Accept": "application/vnd.github.v3+json"},
            timeout=10,
        )
        response.raise_for_status()
        data = response.json()
        results = []
        for repo in data.get("items", [])[:5]:
            results.append({
                "title": repo.get("full_name", ""),
                "link": repo.get("html_url", ""),
                "snippet": repo.get("description", "")[:200],
                "stars": repo.get("stargazers_count", 0),
            })
        return results
    except Exception as e:
        logger.warning("github_search_failed", error=str(e))
        return []


RESOURCE_PROMPT_WITH_RESULTS = """You are a career advisor recommending specific learning resources for "{skill}" at the {seniority} level.

I found these search results:
{search_results}

Based on these results AND your own knowledge of real courses, return a JSON object with:
- "resources": list of 4-5 objects, each with:
  - "title": the SPECIFIC course/resource name (e.g., "Kubernetes for Developers - Udemy by Mumshad Mannambeth", not just "Kubernetes on Udemy")
  - "url": the real URL from search results, or a direct link to the specific course
  - "estimated_hours": realistic hours to complete (integer)
  - "type": one of "course", "project", "cert", "doc"
- "relevance_score": 0.0-1.0 relevance to learning {skill} at {seniority} level

IMPORTANT:
- Use SPECIFIC course names, not generic platform names
- Prefer results from the search data above
- If a search result points to a specific course, use that exact title and URL
- Include a mix: at least 1 course, 1 documentation/tutorial, and 1 project or certification if applicable
- Estimated hours should be realistic (a short tutorial = 2-5h, a full course = 20-40h, a certification = 40-80h)

Return ONLY valid JSON, no markdown fences."""


RESOURCE_PROMPT_LLM_ONLY = """You are a career advisor. Recommend specific, real learning resources for someone who needs to learn "{skill}" at a {seniority} level.

Return a JSON object with:
- "resources": list of 4-5 objects, each with:
  - "title": SPECIFIC real course/resource name (e.g., "CS50's Introduction to Computer Science - Harvard/edX", "The Complete Kubernetes Course - Udemy")
  - "url": the real URL to the course (use actual coursera.org/learn/xxx, udemy.com/course/xxx, or official doc URLs you know)
  - "estimated_hours": realistic hours to complete (integer)
  - "type": one of "course", "project", "cert", "doc"
- "relevance_score": 0.0-1.0 relevance

IMPORTANT:
- Only recommend courses/resources you are confident actually exist
- Use real platform URLs (coursera.org, udemy.com, edx.org, pluralsight.com, official docs)
- Include a mix: courses, documentation, and hands-on projects
- Be specific with names — "Docker Deep Dive by Nigel Poulton" not "Docker course"

Return ONLY valid JSON, no markdown fences."""


@tool
def research_skill_resources(
    skill_name: str,
    seniority_context: str,
) -> dict[str, Any]:
    """Research learning resources for a specific skill gap.

    Makes real external API calls to find courses, projects, certifications,
    and documentation.

    Args:
        skill_name: The skill to find resources for.
        seniority_context: The seniority level context (e.g., "senior", "mid").

    Returns:
        Resources list with title, url, estimated_hours, type, and relevance_score.
    """
    start = time.time()
    cache_key = f"{skill_name}:{seniority_context}"

    if cache_key in _resource_cache:
        logger.info("research_skills_cache_hit", skill=skill_name)
        return _resource_cache[cache_key]

    # --- Real external calls ---
    all_search_results = []

    # 1. DuckDuckGo search for courses
    query = f"best {skill_name} online course tutorial {seniority_context} level"
    ddg_results = _search_duckduckgo(query)
    if ddg_results:
        all_search_results.extend(ddg_results)
        logger.info("research_skills_duckduckgo", skill=skill_name, results=len(ddg_results))

    # 2. GitHub awesome-lists (real external call, always works)
    github_results = _search_github_topics(skill_name)
    if github_results:
        all_search_results.extend(github_results)
        logger.info("research_skills_github", skill=skill_name, results=len(github_results))

    # --- Use LLM to produce specific recommendations ---
    if all_search_results:
        prompt = RESOURCE_PROMPT_WITH_RESULTS.format(
            skill=skill_name,
            seniority=seniority_context,
            search_results=json.dumps(all_search_results[:10], indent=2),
        )
    else:
        logger.info("research_skills_llm_only", skill=skill_name)
        prompt = RESOURCE_PROMPT_LLM_ONLY.format(
            skill=skill_name,
            seniority=seniority_context,
        )

    result = call_llm_json(prompt, SkillResourceResult, max_tokens=2000)

    _resource_cache[cache_key] = result

    latency = int((time.time() - start) * 1000)
    logger.info("research_skills_success", skill=skill_name, latency_ms=latency,
                num_resources=len(result["resources"]))

    return result
