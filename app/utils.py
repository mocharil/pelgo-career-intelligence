"""Shared utilities for the Pelgo career intelligence system."""

from __future__ import annotations

import json
import ipaddress
from typing import Any, Type
from urllib.parse import urlparse

import structlog
from pydantic import BaseModel

logger = structlog.get_logger()


def strip_markdown_json(text: str) -> str:
    """Remove markdown code fence markers from LLM JSON output."""
    if text.startswith("```"):
        lines = text.split("\n")
        text = "\n".join(lines[1:-1] if lines[-1].strip() == "```" else lines[1:])
    return text


def call_llm_json(
    prompt: str,
    response_schema: Type[BaseModel],
    max_tokens: int = 2000,
) -> dict[str, Any]:
    """Call Gemini, strip markdown, parse JSON, validate against Pydantic schema.

    Returns the validated model as a dict.
    Raises ValueError if JSON parsing or validation fails.
    """
    from app.llm import call_gemini

    raw = call_gemini(prompt, max_tokens=max_tokens)
    raw = strip_markdown_json(raw)
    parsed = json.loads(raw)

    if isinstance(parsed, list):
        validated = [response_schema(**item) for item in parsed]
        return [v.model_dump() for v in validated]

    validated = response_schema(**parsed)
    return validated.model_dump()


def validate_url(url: str) -> None:
    """Validate a URL is safe to fetch (SSRF protection).

    Rejects private IPs, loopback, link-local, and cloud metadata endpoints.
    Raises ValueError if the URL is not allowed.
    """
    parsed = urlparse(url)

    if parsed.scheme not in ("http", "https"):
        raise ValueError(f"URL scheme not allowed: {parsed.scheme}")

    hostname = parsed.hostname
    if not hostname:
        raise ValueError("URL has no hostname")

    # Block known dangerous hostnames
    blocked_hosts = {"localhost", "metadata.google.internal"}
    if hostname in blocked_hosts:
        raise ValueError(f"Blocked hostname: {hostname}")

    # Block private/reserved IP ranges
    try:
        ip = ipaddress.ip_address(hostname)
        if ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved:
            raise ValueError(f"Private/reserved IP not allowed: {hostname}")
    except ValueError as e:
        if "not allowed" in str(e):
            raise
        # Not an IP address (it's a hostname) — that's fine


def signal_workers(job_ids: list[str]) -> None:
    """Signal worker processes about new jobs via Redis queue."""
    from app.config import settings

    try:
        import redis as redis_lib
        r = redis_lib.Redis.from_url(settings.redis_url)
        for job_id in job_ids:
            r.lpush("pelgo:job_queue", job_id)
        r.close()
    except Exception as e:
        logger.warning("redis_signal_failed", error=str(e))
