"""LLM abstraction layer — multi-provider with fallback and task-based model routing.

Supports:
  - Primary: Google Gemini via Vertex AI
  - Fallback: OpenAI GPT (if OPENAI_API_KEY is set)
  - Model routing based on task complexity

If Gemini is down or times out, automatically falls back to OpenAI.
If no fallback is configured, raises the original error.
"""

from __future__ import annotations

import os
import time
from enum import Enum
from typing import Optional

import structlog
from google.oauth2 import service_account
import vertexai
from vertexai.generative_models import GenerativeModel

from app.config import settings

logger = structlog.get_logger()

_vertex_initialized = False


# --- Task Complexity ---

class TaskComplexity(str, Enum):
    """Route to different models based on task complexity."""
    LIGHT = "light"     # extraction, prioritisation — cheap fast model
    STANDARD = "standard"  # scoring, resume parsing — balanced model
    HEAVY = "heavy"     # re-scoring with context, complex reasoning — best model


# Model routing table: complexity → model name
# This lets us use a cheaper model for simple tasks and save cost
MODEL_ROUTING = {
    TaskComplexity.LIGHT: settings.gemini_model,           # gemini-2.5-flash-lite (cheapest)
    TaskComplexity.STANDARD: settings.gemini_model,        # same for now, can upgrade to gemini-2.0-flash
    TaskComplexity.HEAVY: settings.gemini_model_heavy,     # gemini-2.0-flash or gemini-2.5-pro
}


# --- Vertex AI Init ---

def _init_vertex():
    """Initialize Vertex AI with service account credentials."""
    global _vertex_initialized
    if _vertex_initialized:
        return

    creds_path = settings.google_application_credentials
    if creds_path and os.path.exists(creds_path):
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
    else:
        # Cloud Run: Workload Identity provides credentials automatically
        vertexai.init(
            project=settings.google_cloud_project,
            location=settings.google_cloud_location,
        )

    _vertex_initialized = True


def get_gemini_model(model_name: Optional[str] = None) -> GenerativeModel:
    """Get a Gemini GenerativeModel instance."""
    _init_vertex()
    return GenerativeModel(model_name or settings.gemini_model)


# --- Token Tracking ---

_last_token_count: int = 0


def get_last_token_count() -> int:
    """Return the token count from the most recent call_llm invocation."""
    return _last_token_count


# --- Provider: Gemini ---

def _call_gemini(prompt: str, max_tokens: int = 8192, model_name: Optional[str] = None) -> str:
    """Call Gemini via Vertex AI. Raises on failure."""
    global _last_token_count

    model = get_gemini_model(model_name)
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
            provider="gemini",
            model=model_name or settings.gemini_model,
            prompt_tokens=usage.prompt_token_count,
            completion_tokens=usage.candidates_token_count,
            total_tokens=usage.total_token_count,
        )
    except Exception:
        pass

    return response.text.strip()


# --- Provider: OpenAI (Fallback) ---

def _call_openai(prompt: str, max_tokens: int = 8192, model_name: Optional[str] = None) -> str:
    """Call OpenAI API as fallback. Requires OPENAI_API_KEY env var."""
    global _last_token_count

    try:
        from openai import OpenAI
    except ImportError:
        raise RuntimeError("openai package not installed — cannot use OpenAI fallback")

    api_key = settings.openai_api_key
    if not api_key:
        raise RuntimeError("OPENAI_API_KEY not set — cannot use OpenAI fallback")

    client = OpenAI(api_key=api_key)
    model = model_name or settings.openai_fallback_model

    response = client.chat.completions.create(
        model=model,
        messages=[{"role": "user", "content": prompt}],
        max_tokens=max_tokens,
        temperature=0,
    )

    # Log token usage
    try:
        usage = response.usage
        _last_token_count = usage.total_tokens
        logger.info(
            "llm_token_usage",
            provider="openai",
            model=model,
            prompt_tokens=usage.prompt_tokens,
            completion_tokens=usage.completion_tokens,
            total_tokens=usage.total_tokens,
        )
    except Exception:
        pass

    return response.choices[0].message.content.strip()


# --- Unified Call with Fallback ---

PROVIDER_CHAIN = [
    ("gemini", _call_gemini),
    ("openai", _call_openai),
]


def call_llm(
    prompt: str,
    max_tokens: int = 8192,
    complexity: TaskComplexity = TaskComplexity.STANDARD,
) -> str:
    """Call LLM with automatic fallback across providers.

    Tries Gemini first. If Gemini fails (timeout, rate limit, down),
    falls back to OpenAI. If all providers fail, raises the last error.

    Args:
        prompt: The prompt text.
        max_tokens: Maximum output tokens.
        complexity: Task complexity — routes to appropriate model tier.

    Returns:
        LLM response text.
    """
    model_name = MODEL_ROUTING.get(complexity, settings.gemini_model)
    last_error = None

    for provider_name, provider_fn in PROVIDER_CHAIN:
        start = time.time()
        try:
            if provider_name == "gemini":
                result = provider_fn(prompt, max_tokens=max_tokens, model_name=model_name)
            else:
                # Fallback providers use their own model selection
                result = provider_fn(prompt, max_tokens=max_tokens)

            latency = int((time.time() - start) * 1000)
            logger.info(
                "llm_call_success",
                provider=provider_name,
                complexity=complexity.value,
                latency_ms=latency,
            )
            return result

        except Exception as e:
            latency = int((time.time() - start) * 1000)
            last_error = e
            logger.warning(
                "llm_provider_failed",
                provider=provider_name,
                error=str(e),
                latency_ms=latency,
                complexity=complexity.value,
                will_retry=provider_name != PROVIDER_CHAIN[-1][0],
            )
            continue

    # All providers failed
    logger.error("llm_all_providers_failed", error=str(last_error))
    raise last_error


# --- Backward Compatibility ---

def call_gemini(prompt: str, max_tokens: int = 8192) -> str:
    """Backward-compatible wrapper. Routes through the unified call_llm with fallback.

    All existing code that calls call_gemini() will now automatically get
    fallback behavior without any code changes.
    """
    return call_llm(prompt, max_tokens=max_tokens, complexity=TaskComplexity.STANDARD)
