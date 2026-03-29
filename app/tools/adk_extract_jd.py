"""Google ADK implementation of extract_jd_requirements.

This is the stretch goal — implementing one of the required tools using
Google Agent Development Kit (ADK) with its tool registration, session
management, and event streaming primitives.

ADK Value over LangGraph alone:
- Built-in session management with state persistence across turns
- Event streaming for real-time progress updates to clients
- Native Gemini integration without LangChain adapter overhead
- Tool registration via decorators with automatic schema inference
- Artifact management for storing intermediate results
"""

from __future__ import annotations

import hashlib
import json
import os
from typing import Any

import structlog

from app.config import settings

logger = structlog.get_logger()

# Cache shared with the LangGraph version
_extraction_cache: dict[str, dict[str, Any]] = {}


def _content_hash(text: str) -> str:
    return hashlib.sha256(text.encode()).hexdigest()[:16]


def _ensure_credentials():
    os.environ["GOOGLE_APPLICATION_CREDENTIALS"] = settings.google_application_credentials
    os.environ["GOOGLE_CLOUD_PROJECT"] = settings.google_cloud_project
    os.environ["GOOGLE_CLOUD_LOCATION"] = settings.google_cloud_location


EXTRACT_PROMPT = """You are a job description parser. Extract structured information from the following job description.

Return a JSON object with exactly these fields:
- "required_skills": list of strings — hard skills explicitly required
- "nice_to_have_skills": list of strings — skills listed as preferred/nice-to-have/bonus
- "seniority_level": one of "intern", "junior", "mid", "senior", "staff", "lead", "principal", "director"
- "domain": string — the industry/domain (e.g., "fintech", "healthcare", "e-commerce")
- "responsibilities": list of strings — key responsibilities

Be precise. Only include skills explicitly mentioned. Infer seniority from title, years required, and responsibilities.

Job Description:
{jd_text}

Return ONLY valid JSON, no markdown fences."""


def create_adk_agent():
    """Create a Google ADK agent with the extract_jd tool registered.

    Uses ADK's native tool registration, session management, and
    Gemini integration.
    """
    _ensure_credentials()

    from google.adk.agents import Agent
    from google.adk.tools import FunctionTool

    # Define the tool function for ADK registration
    def extract_jd_requirements_adk(job_text: str) -> dict:
        """Extract structured requirements from a job description text.

        Args:
            job_text: The raw job description text to parse.

        Returns:
            dict with required_skills, nice_to_have_skills, seniority_level, domain, responsibilities.
        """
        from app.models.schemas import JobRequirements

        # Check cache
        cache_key = _content_hash(job_text)
        if cache_key in _extraction_cache:
            logger.info("adk_extract_jd_cache_hit", cache_key=cache_key)
            return _extraction_cache[cache_key]

        # Use Gemini via ADK's native integration
        from app.utils import call_llm_json

        result = call_llm_json(
            EXTRACT_PROMPT.format(jd_text=job_text),
            JobRequirements,
            max_tokens=2000,
        )

        _extraction_cache[cache_key] = result
        logger.info("adk_extract_jd_success", num_skills=len(result["required_skills"]))

        return result

    # Register as ADK FunctionTool
    extract_tool = FunctionTool(func=extract_jd_requirements_adk)

    # Create ADK Agent with the tool
    agent = Agent(
        model=settings.gemini_model,
        name="jd_extractor",
        description="Extracts structured requirements from job descriptions",
        instruction=(
            "You are a job description parser. When given a job description, "
            "use the extract_jd_requirements_adk tool to extract structured requirements. "
            "Always call the tool with the full job description text."
        ),
        tools=[extract_tool],
    )

    return agent


async def run_adk_extraction(jd_text: str) -> dict[str, Any]:
    """Run the ADK agent to extract JD requirements.

    Demonstrates ADK's session management and event streaming.
    """
    _ensure_credentials()

    from google.adk.agents import Agent
    from google.adk.runners import Runner
    from google.adk.sessions import InMemorySessionService
    from google.genai import types

    agent = create_adk_agent()

    # ADK Session Management — creates a managed session
    session_service = InMemorySessionService()
    session = await session_service.create_session(
        app_name="pelgo_jd_extractor",
        user_id="system",
    )

    # ADK Runner — handles the agent execution lifecycle
    runner = Runner(
        agent=agent,
        app_name="pelgo_jd_extractor",
        session_service=session_service,
    )

    # Create user message
    user_message = types.Content(
        role="user",
        parts=[types.Part.from_text(f"Extract requirements from this job description:\n\n{jd_text}")]
    )

    # ADK Event Streaming — iterate over events for real-time updates
    final_result = None
    async for event in runner.run_async(
        user_id="system",
        session_id=session.id,
        new_message=user_message,
    ):
        # Log each event for observability
        if event.content and event.content.parts:
            for part in event.content.parts:
                if part.function_call:
                    logger.info(
                        "adk_event_tool_call",
                        tool=part.function_call.name,
                        session_id=session.id,
                    )
                elif part.function_response:
                    logger.info(
                        "adk_event_tool_response",
                        tool=part.function_response.name,
                        session_id=session.id,
                    )
                elif part.text:
                    final_result = part.text

    # Parse the tool result from the session
    # The tool function returns structured data directly
    if final_result:
        try:
            parsed = json.loads(final_result)
            from app.models.schemas import JobRequirements
            validated = JobRequirements(**parsed)
            return validated.model_dump()
        except (json.JSONDecodeError, Exception):
            pass

    # Fallback: check cache (tool may have populated it)
    cache_key = _content_hash(jd_text)
    if cache_key in _extraction_cache:
        return _extraction_cache[cache_key]

    raise RuntimeError("ADK extraction did not produce a valid result")
