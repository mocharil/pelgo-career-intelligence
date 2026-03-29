"""Typed agent state for LangGraph orchestration."""

from __future__ import annotations

from typing import Any, Optional

from typing_extensions import TypedDict


class AgentState(TypedDict, total=False):
    """Typed state that the LangGraph orchestrator manages across tool calls.

    This is NOT a global variable — it is created per-run and passed through
    the graph by LangGraph's state management.
    """

    # Inputs
    job_id: str
    candidate_profile: dict[str, Any]
    job_description_text: str
    job_url: Optional[str]

    # Tool outputs (populated as the agent runs)
    requirements: Optional[dict[str, Any]]
    scoring_result: Optional[dict[str, Any]]
    prioritised_gaps: Optional[list[dict[str, Any]]]
    skill_resources: dict[str, Any]  # skill_name -> resources

    # Agent reasoning
    messages: list[Any]  # LangGraph message history
    current_step: str
    should_gather_more_signal: bool
    retry_counts: dict[str, int]  # tool_name -> retry count

    # Trace (populated by orchestrator, NOT by LLM)
    agent_trace: dict[str, Any]
    total_llm_calls: int
    fallbacks_triggered: int

    # Progress callback (called after each tool to update DB)
    progress_callback: Optional[Any]  # Callable[[dict], None]

    # Final output
    final_output: Optional[dict[str, Any]]
    error: Optional[str]
