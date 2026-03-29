"""Centralized LLM client using Google Gemini via Vertex AI."""

from __future__ import annotations

import os

import structlog
from google.oauth2 import service_account
import vertexai
from vertexai.generative_models import GenerativeModel

from app.config import settings

logger = structlog.get_logger()

_initialized = False


def _init_vertex():
    """Initialize Vertex AI with service account credentials."""
    global _initialized
    if _initialized:
        return

    creds_path = settings.google_application_credentials
    os.environ["GOOGLE_APPLICATION_CREDENTIALS"] = creds_path

    credentials = service_account.Credentials.from_service_account_file(
        creds_path,
        scopes=["https://www.googleapis.com/auth/cloud-platform"],
    )

    vertexai.init(
        project=settings.google_cloud_project,
        location=settings.google_cloud_location,
        credentials=credentials,
    )
    _initialized = True


def get_gemini_model() -> GenerativeModel:
    """Get a Gemini GenerativeModel instance."""
    _init_vertex()
    return GenerativeModel(settings.gemini_model)


_last_token_count: int = 0


def get_last_token_count() -> int:
    """Return the token count from the most recent call_gemini invocation."""
    return _last_token_count


def call_gemini(prompt: str, max_tokens: int = 4096) -> str:
    """Call Gemini and return the text response. Logs token usage."""
    global _last_token_count
    _last_token_count = 0

    model = get_gemini_model()
    response = model.generate_content(
        prompt,
        generation_config={
            "max_output_tokens": max_tokens,
            "temperature": 0,
        },
    )

    # Log token usage
    try:
        usage = response.usage_metadata
        _last_token_count = usage.total_token_count
        logger.info(
            "llm_token_usage",
            prompt_tokens=usage.prompt_token_count,
            completion_tokens=usage.candidates_token_count,
            total_tokens=usage.total_token_count,
            model=settings.gemini_model,
        )
    except Exception:
        pass

    return response.text.strip()
