"""LangGraph agent orchestrator — typed state, runtime tool sequencing, real agent_trace."""

from __future__ import annotations

import json
import os
import time
import uuid
from typing import Any, Literal

import structlog
from langchain_core.messages import AIMessage, HumanMessage, SystemMessage, ToolMessage
from langchain_google_vertexai import ChatVertexAI
from langgraph.graph import END, StateGraph

from app.config import settings
from app.models.agent_state import AgentState
from app.models.schemas import (
    AgentTrace,
    Confidence,
    LearningPlanEntry,
    MatchResult,
    SkillResource,
    ToolCallTrace,
)
from app.agent.failure_handlers import (
    handle_low_confidence,
    validate_or_retry_extraction,
    validate_or_retry_scoring,
    with_timeout,
)
from app.tools.extract_jd import extract_jd_requirements
from app.tools.prioritise_gaps import prioritise_skill_gaps
from app.tools.research_skills import research_skill_resources
from app.tools.score_candidate import score_candidate_against_requirements

logger = structlog.get_logger()

# Safety limits
MAX_TOOL_CALLS = 10
MAX_LLM_CALLS = 8

# System prompt for the agent
SYSTEM_PROMPT = """You are Pelgo's Career Intelligence Agent. Your ONLY job is to analyze how well a candidate matches a job description and create an actionable learning plan.

IMPORTANT: You MUST use your tools to complete this task. Do NOT try to answer without calling tools first. Your FIRST action must ALWAYS be to call extract_jd_requirements.

You have access to these tools:
1. extract_jd_requirements — Parse a job description into structured requirements
2. score_candidate_against_requirements — Score a candidate against requirements
3. prioritise_skill_gaps — Rank skill gaps by impact and market demand
4. research_skill_resources — Find learning resources for specific skills

MANDATORY WORKFLOW (you must follow this exact sequence):
1. FIRST: Call extract_jd_requirements with the job description text. This is REQUIRED.
2. THEN: Call score_candidate_against_requirements with the candidate profile and extracted requirements.
3. If confidence is LOW, consider re-extracting with more detail.
4. Call prioritise_skill_gaps with the gap skills (do NOT research all gaps blindly).
5. Call research_skill_resources ONLY for the top 3 priority gaps.
6. Compile the final match result.

RULES:
- Always start with extract_jd_requirements.
- After scoring, check confidence. If LOW, try to gather more signal before accepting.
- Only research the top 3 priority skills, not all gaps.
- If a tool fails, decide whether to retry, skip, or use partial data.
- Stop after you have enough information to produce a final answer."""


# Tool definitions for LangChain binding
ALL_TOOLS = [
    extract_jd_requirements,
    score_candidate_against_requirements,
    research_skill_resources,
    prioritise_skill_gaps,
]


def _ensure_vertex_credentials():
    """Ensure Vertex AI credentials are set."""
    os.environ["GOOGLE_APPLICATION_CREDENTIALS"] = settings.google_application_credentials
    from app.llm import _init_vertex
    _init_vertex()


def _create_llm():
    _ensure_vertex_credentials()
    return ChatVertexAI(
        model=settings.gemini_model,
        project=settings.google_cloud_project,
        location=settings.google_cloud_location,
        max_output_tokens=4096,
        temperature=0,
    ).bind_tools(ALL_TOOLS)


def _init_state(
    job_id: str,
    candidate_profile: dict[str, Any],
    job_description_text: str,
    job_url: str | None = None,
    progress_callback: Any = None,
) -> AgentState:
    """Create initial agent state."""
    return AgentState(
        job_id=job_id,
        candidate_profile=candidate_profile,
        job_description_text=job_description_text,
        job_url=job_url,
        requirements=None,
        scoring_result=None,
        prioritised_gaps=None,
        skill_resources={},
        messages=[],
        current_step="init",
        should_gather_more_signal=False,
        retry_counts={},
        agent_trace={
            "tool_calls": [],
            "total_llm_calls": 0,
            "fallbacks_triggered": 0,
            "total_tokens_used": 0,
        },
        total_llm_calls=0,
        fallbacks_triggered=0,
        progress_callback=progress_callback,
        final_output=None,
        error=None,
    )


# --- Graph Nodes ---

def agent_reason(state: AgentState) -> AgentState:
    """LLM reasoning node — decides which tool to call next."""
    llm = _create_llm()

    messages = list(state.get("messages", []))

    # If no messages yet, start with the task description
    if not messages:
        jd_source = state.get("job_url") or "provided text"
        messages.append(SystemMessage(content=SYSTEM_PROMPT))
        messages.append(HumanMessage(content=(
            f"Analyze this candidate-job match.\n\n"
            f"CANDIDATE PROFILE:\n{json.dumps(state['candidate_profile'], indent=2)}\n\n"
            f"JOB DESCRIPTION:\n{state['job_description_text']}\n\n"
            f"JD Source: {jd_source}\n\n"
            f"Follow the workflow: extract → score → prioritise → research top gaps → compile result."
        )))

    start = time.time()
    response = llm.invoke(messages)
    latency = int((time.time() - start) * 1000)

    # Safety: if first call and LLM didn't return tool calls, add hint and retry once
    if not response.tool_calls and not state.get("scoring_result") and state.get("current_step") == "init":
        logger.warning("agent_no_tools_on_first_call_retrying")
        messages.append(response)
        messages.append(HumanMessage(content=(
            "You MUST call extract_jd_requirements now. Do not respond with text. "
            "Call the tool with the job description text provided above."
        )))
        response = llm.invoke(messages)
        latency += int((time.time() - start) * 1000)

    messages.append(response)

    # Estimate token usage from response metadata
    token_count = 0
    try:
        if hasattr(response, 'usage_metadata') and response.usage_metadata:
            token_count = getattr(response.usage_metadata, 'total_token_count', 0) or 0
        elif hasattr(response, 'response_metadata'):
            token_count = response.response_metadata.get('token_usage', {}).get('total_tokens', 0)
    except Exception:
        pass

    state = {**state}
    state["messages"] = messages
    state["total_llm_calls"] = state.get("total_llm_calls", 0) + 1
    prev_trace = state.get("agent_trace", {})
    state["agent_trace"] = {
        **prev_trace,
        "total_llm_calls": state["total_llm_calls"],
        "total_tokens_used": prev_trace.get("total_tokens_used", 0) + token_count,
    }

    logger.info("agent_reason", step=state.get("current_step"), latency_ms=latency,
                has_tool_calls=bool(response.tool_calls), tokens=token_count)

    return state


def execute_tools(state: AgentState) -> AgentState:
    """Execute tool calls decided by the LLM, record real trace."""
    state = {**state}
    messages = list(state.get("messages", []))
    last_msg = messages[-1]

    if not isinstance(last_msg, AIMessage) or not last_msg.tool_calls:
        return state

    tool_map = {t.name: t for t in ALL_TOOLS}
    trace = state.get("agent_trace", {"tool_calls": [], "total_llm_calls": 0, "fallbacks_triggered": 0})
    tool_calls_trace = list(trace.get("tool_calls", []))
    fallbacks = trace.get("fallbacks_triggered", 0)

    for tc in last_msg.tool_calls:
        tool_name = tc["name"]
        tool_args = tc["args"]
        tool_id = tc["id"]

        # Gemini 2.5 sometimes passes tool args as JSON strings instead of dicts
        # Recursively parse all string values that are valid JSON
        def parse_json_strings(obj: Any) -> Any:
            if isinstance(obj, str):
                stripped = obj.strip()
                if stripped.startswith(("{", "[")):
                    try:
                        return parse_json_strings(json.loads(stripped))
                    except (json.JSONDecodeError, TypeError):
                        pass
            elif isinstance(obj, dict):
                return {k: parse_json_strings(v) for k, v in obj.items()}
            elif isinstance(obj, list):
                return [parse_json_strings(item) for item in obj]
            return obj

        tool_args = parse_json_strings(tool_args)
        if not isinstance(tool_args, dict):
            try:
                tool_args = json.loads(str(tool_args))
            except (json.JSONDecodeError, TypeError):
                tool_args = {"input": tool_args}

        logger.info("executing_tool", tool=tool_name, args_keys=list(tool_args.keys()) if isinstance(tool_args, dict) else "raw")

        start = time.time()
        status = "success"
        error_msg = None
        result = None

        try:
            tool_fn = tool_map.get(tool_name)
            if not tool_fn:
                raise ValueError(f"Unknown tool: {tool_name}")

            # Try Google ADK first for extract_jd_requirements (stretch integration)
            if tool_name == "extract_jd_requirements":
                try:
                    import asyncio
                    from app.tools.adk_extract_jd import run_adk_extraction
                    jd_input = tool_args.get("job_url_or_text", "")
                    loop = asyncio.new_event_loop()
                    try:
                        raw_result = loop.run_until_complete(run_adk_extraction(jd_input))
                        logger.info("adk_extract_used", tool=tool_name)
                    finally:
                        loop.close()
                except Exception as adk_err:
                    logger.info("adk_fallback_to_langgraph", tool=tool_name, error=str(adk_err))
                    raw_result = None  # fall through to LangGraph tool below

                if raw_result is not None:
                    result = raw_result
                    # Skip the normal tool execution below
                    validated = validate_or_retry_extraction(result)
                    result = validated if validated else result
                    state["requirements"] = result
                    state["current_step"] = "extracted"

                    latency = int((time.time() - start) * 1000)
                    tool_calls_trace.append(
                        ToolCallTrace(tool=tool_name, status="success", latency_ms=latency).model_dump()
                    )
                    messages.append(ToolMessage(
                        content=json.dumps(result) if isinstance(result, dict) else str(result),
                        tool_call_id=tool_id,
                    ))
                    state["agent_trace"] = {
                        "tool_calls": tool_calls_trace,
                        "total_llm_calls": state.get("total_llm_calls", 0),
                        "fallbacks_triggered": fallbacks,
                        "total_tokens_used": trace.get("total_tokens_used", 0),
                    }
                    progress_cb = state.get("progress_callback")
                    if progress_cb:
                        try:
                            progress_cb({"current_step": "extracted", "agent_trace": state["agent_trace"]})
                        except Exception:
                            pass
                    continue  # skip normal tool execution for this tool call

            # Mode 1: Execute with timeout protection
            try:
                raw_result = with_timeout(tool_fn.invoke, tool_args)
            except TimeoutError:
                logger.warning("tool_timeout_triggered", tool=tool_name)
                raise

            # LangChain tools may return string-serialized JSON — parse it
            if isinstance(raw_result, str):
                try:
                    result = json.loads(raw_result)
                except (json.JSONDecodeError, TypeError):
                    result = {"raw": raw_result}
            else:
                result = raw_result

            # Mode 2: Validate tool output, recover partial data if malformed
            if tool_name == "extract_jd_requirements":
                validated = validate_or_retry_extraction(result)
                result = validated if validated else result
                state["requirements"] = result
                state["current_step"] = "extracted"
            elif tool_name == "score_candidate_against_requirements":
                validated = validate_or_retry_scoring(result)
                result = validated if validated else result
                state["scoring_result"] = result
                state["current_step"] = "scored"
                # Mode 3: Flag low confidence for the routing logic
                if isinstance(result, dict) and result.get("confidence") == "low":
                    state["should_gather_more_signal"] = True
            elif tool_name == "prioritise_skill_gaps":
                state["prioritised_gaps"] = result
                state["current_step"] = "prioritised"
            elif tool_name == "research_skill_resources":
                skill_name = tool_args.get("skill_name", "unknown")
                resources = state.get("skill_resources", {})
                resources[skill_name] = result
                state["skill_resources"] = resources
                state["current_step"] = "researched"

        except Exception as e:
            status = "error"
            error_msg = str(e)
            result = {"error": error_msg}
            logger.error("tool_error", tool=tool_name, error=error_msg)

            # Retry logic
            retry_counts = dict(state.get("retry_counts", {}))
            retries = retry_counts.get(tool_name, 0)
            if retries < 1:
                retry_counts[tool_name] = retries + 1
                state["retry_counts"] = retry_counts
                fallbacks += 1
                logger.info("tool_retry_scheduled", tool=tool_name, attempt=retries + 1)
            else:
                logger.warning("tool_max_retries", tool=tool_name)
                fallbacks += 1

        latency = int((time.time() - start) * 1000)

        # Record REAL trace
        tool_calls_trace.append(
            ToolCallTrace(
                tool=tool_name,
                status=status,
                latency_ms=latency,
                error=error_msg,
            ).model_dump()
        )

        # Add tool result message
        messages.append(ToolMessage(
            content=json.dumps(result) if isinstance(result, dict) else str(result),
            tool_call_id=tool_id,
        ))

        # Update trace in state
        state["agent_trace"] = {
            "tool_calls": tool_calls_trace,
            "total_llm_calls": state.get("total_llm_calls", 0),
            "fallbacks_triggered": fallbacks,
        }

        # Call progress callback to save incremental trace to DB
        progress_cb = state.get("progress_callback")
        if progress_cb:
            try:
                progress_cb({
                    "current_step": state.get("current_step", "processing"),
                    "agent_trace": state["agent_trace"],
                })
            except Exception as e:
                logger.warning("progress_callback_error", error=str(e))

    state["messages"] = messages
    state["fallbacks_triggered"] = fallbacks

    return state


def compile_output(state: AgentState) -> AgentState:
    """Compile the final structured output from accumulated state."""
    state = {**state}

    scoring = state.get("scoring_result") or {}
    requirements = state.get("requirements") or {}
    prioritised = state.get("prioritised_gaps") or []
    skill_resources = state.get("skill_resources", {})

    # Build learning plan from prioritised gaps + researched resources
    learning_plan = []
    for gap in prioritised[:5]:
        skill = gap["skill"]
        resources_data = skill_resources.get(skill, {})
        resources_list = resources_data.get("resources", []) if isinstance(resources_data, dict) else []

        learning_plan.append(
            LearningPlanEntry(
                skill=skill,
                priority_rank=gap["priority_rank"],
                estimated_match_gain_pct=gap["estimated_match_gain_pct"],
                resources=[SkillResource(**r) for r in resources_list[:3]],
                rationale=gap["rationale"],
            ).model_dump()
        )

    # Build reasoning
    matched = scoring.get("matched_skills", [])
    gaps = scoring.get("gap_skills", [])
    score = scoring.get("overall_score", 0)
    raw_confidence = scoring.get("confidence", "medium")
    # Ensure confidence is a plain string value (not enum repr)
    confidence_str = raw_confidence.value if hasattr(raw_confidence, 'value') else str(raw_confidence)

    reasoning = (
        f"Candidate matches {len(matched)} of {len(matched) + len(gaps)} required skills "
        f"with an overall score of {score}/100 ({confidence_str} confidence). "
        f"Key gaps: {', '.join(gaps[:3]) if gaps else 'none identified'}. "
        f"Domain: {requirements.get('domain', 'unknown')}."
    )

    result = MatchResult(
        job_id=uuid.UUID(state["job_id"]),
        overall_score=score,
        confidence=Confidence(confidence_str),
        dimension_scores=scoring.get("dimension_scores", {"skills": 0, "experience": 0, "seniority_fit": 0}),
        matched_skills=matched,
        gap_skills=gaps,
        reasoning=reasoning,
        learning_plan=learning_plan,
        agent_trace=AgentTrace(**state.get("agent_trace", {})),
    )

    state["final_output"] = result.model_dump(mode="json")
    state["current_step"] = "completed"

    logger.info("agent_compile_output", score=score, confidence=confidence_str,
                num_learning_plan=len(learning_plan))

    return state


# --- Routing ---

def should_continue(state: AgentState) -> Literal["execute_tools", "compile_output"]:
    """Decide whether to execute tools or compile final output."""
    messages = state.get("messages", [])
    if not messages:
        return "compile_output"

    last = messages[-1]

    if isinstance(last, AIMessage) and last.tool_calls:
        return "execute_tools"

    return "compile_output"


def after_tools(state: AgentState) -> Literal["agent_reason", "compile_output"]:
    """After tool execution, decide whether to reason more or compile."""
    total_tool_calls = len(state.get("agent_trace", {}).get("tool_calls", []))
    total_llm_calls = state.get("total_llm_calls", 0)

    # Safety limit
    if total_tool_calls >= MAX_TOOL_CALLS or total_llm_calls >= MAX_LLM_CALLS:
        logger.warning("agent_safety_limit", tool_calls=total_tool_calls, llm_calls=total_llm_calls)
        return "compile_output"

    scoring = state.get("scoring_result")
    prioritised = state.get("prioritised_gaps")
    resources = state.get("skill_resources", {})

    # Mode 3: If confidence is low, inject diagnostic context before continuing
    if state.get("should_gather_more_signal") and scoring:
        guidance = handle_low_confidence(
            scoring,
            state.get("requirements", {}),
            state.get("candidate_profile", {}),
        )
        if guidance:
            messages = list(state.get("messages", []))
            messages.append(HumanMessage(content=guidance))
            state["messages"] = messages
            state["should_gather_more_signal"] = False  # Only inject once
            return "agent_reason"

    if scoring and prioritised and len(resources) >= min(3, len(prioritised)):
        return "compile_output"

    return "agent_reason"


# --- Build Graph ---

def build_agent_graph() -> StateGraph:
    """Build the LangGraph agent graph."""
    graph = StateGraph(AgentState)

    graph.add_node("agent_reason", agent_reason)
    graph.add_node("execute_tools", execute_tools)
    graph.add_node("compile_output", compile_output)

    graph.set_entry_point("agent_reason")

    graph.add_conditional_edges("agent_reason", should_continue)
    graph.add_conditional_edges("execute_tools", after_tools)
    graph.add_edge("compile_output", END)

    return graph.compile()


async def run_agent(
    job_id: str,
    candidate_profile: dict[str, Any],
    job_description_text: str,
    job_url: str | None = None,
    progress_callback: Any = None,
) -> dict[str, Any]:
    """Run the agent pipeline and return the final MatchResult."""
    logger.info("agent_run_start", job_id=job_id)
    start = time.time()

    state = _init_state(
        job_id, candidate_profile, job_description_text, job_url,
        progress_callback=progress_callback,
    )

    graph = build_agent_graph()
    final_state = graph.invoke(state)

    total_time = int((time.time() - start) * 1000)
    logger.info("agent_run_complete", job_id=job_id, total_time_ms=total_time)

    if final_state.get("final_output"):
        return final_state["final_output"]

    raise RuntimeError(
        f"Agent did not produce final output. Last step: {final_state.get('current_step')}. "
        f"Error: {final_state.get('error')}"
    )
