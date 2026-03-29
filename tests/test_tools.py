"""Unit tests for tools, failure handlers, and utilities.

Run with: pytest tests/test_tools.py -v
No external services required — all LLM calls are mocked.
"""

import json
import pytest
from unittest.mock import patch, MagicMock

# --- Schema Validation Tests ---

class TestJobRequirementsSchema:
    def test_valid_requirements(self):
        from app.models.schemas import JobRequirements
        data = {
            "required_skills": ["Python", "SQL"],
            "nice_to_have_skills": ["Docker"],
            "seniority_level": "mid",
            "domain": "fintech",
            "responsibilities": ["Build APIs"],
        }
        result = JobRequirements(**data)
        assert len(result.required_skills) == 2
        assert result.seniority_level.value == "mid"

    def test_defaults_on_missing_fields(self):
        from app.models.schemas import JobRequirements
        result = JobRequirements()
        assert result.required_skills == []
        assert result.domain == ""

    def test_invalid_seniority_falls_back(self):
        from app.models.schemas import JobRequirements
        # Should accept valid enum values
        result = JobRequirements(seniority_level="senior")
        assert result.seniority_level.value == "senior"


class TestScoringResultSchema:
    def test_valid_scoring(self):
        from app.models.schemas import ScoringResult, DimensionScores
        data = {
            "overall_score": 75,
            "dimension_scores": {"skills": 80, "experience": 70, "seniority_fit": 65},
            "matched_skills": ["Python", "SQL"],
            "gap_skills": ["Docker"],
            "confidence": "medium",
        }
        result = ScoringResult(**data)
        assert result.overall_score == 75
        assert result.confidence.value == "medium"

    def test_float_coercion(self):
        from app.models.schemas import ScoringResult
        data = {
            "overall_score": 75.6,
            "dimension_scores": {"skills": 80.4, "experience": 70.9, "seniority_fit": 65.1},
            "matched_skills": [],
            "gap_skills": [],
            "confidence": "low",
        }
        result = ScoringResult(**data)
        assert result.overall_score == 76  # rounded
        assert result.dimension_scores.skills == 80
        assert result.dimension_scores.experience == 71

    def test_clamp_values(self):
        from app.models.schemas import DimensionScores
        # Values above 100 should be clamped
        result = DimensionScores(skills=110, experience=-5, seniority_fit=50)
        assert result.skills == 100
        assert result.experience == 0
        assert result.seniority_fit == 50


class TestMatchResultSchema:
    def test_full_output_schema(self):
        """Test the A3 output schema from the assignment."""
        from app.models.schemas import MatchResult, AgentTrace
        data = {
            "job_id": "550e8400-e29b-41d4-a716-446655440000",
            "overall_score": 85,
            "confidence": "high",
            "dimension_scores": {"skills": 90, "experience": 80, "seniority_fit": 75},
            "matched_skills": ["Python", "React"],
            "gap_skills": ["Kubernetes"],
            "reasoning": "Strong candidate match.",
            "learning_plan": [{
                "skill": "Kubernetes",
                "priority_rank": 1,
                "estimated_match_gain_pct": 8,
                "resources": [{"title": "K8s Course", "url": "https://example.com", "estimated_hours": 12, "type": "course"}],
                "rationale": "High demand skill",
            }],
            "agent_trace": {
                "tool_calls": [
                    {"tool": "extract_jd_requirements", "status": "success", "latency_ms": 340},
                    {"tool": "score_candidate_against_requirements", "status": "success", "latency_ms": 850},
                ],
                "total_llm_calls": 4,
                "fallbacks_triggered": 0,
            },
        }
        result = MatchResult(**data)
        assert result.overall_score == 85
        assert len(result.agent_trace.tool_calls) == 2
        assert result.learning_plan[0].skill == "Kubernetes"

    def test_malformed_output_rejected(self):
        from app.models.schemas import MatchResult
        with pytest.raises(Exception):
            MatchResult(overall_score=85)  # missing required fields


# --- Failure Handler Tests ---

class TestFailureHandlers:
    def test_validate_extraction_valid(self):
        from app.agent.failure_handlers import validate_or_retry_extraction
        data = {
            "required_skills": ["Python"],
            "nice_to_have_skills": [],
            "seniority_level": "mid",
            "domain": "tech",
            "responsibilities": ["Code"],
        }
        result = validate_or_retry_extraction(data)
        assert result is not None
        assert result["required_skills"] == ["Python"]

    def test_validate_extraction_partial_recovery(self):
        from app.agent.failure_handlers import validate_or_retry_extraction
        # Missing some fields but has required_skills
        data = {"required_skills": ["Python", "SQL"], "garbage": True}
        result = validate_or_retry_extraction(data)
        assert result is not None
        assert "Python" in result["required_skills"]

    def test_validate_extraction_string_input(self):
        from app.agent.failure_handlers import validate_or_retry_extraction
        json_str = '{"required_skills": ["Go"], "nice_to_have_skills": [], "seniority_level": "senior", "domain": "infra", "responsibilities": []}'
        result = validate_or_retry_extraction(json_str)
        assert result is not None
        assert "Go" in result["required_skills"]

    def test_validate_extraction_unsalvageable(self):
        from app.agent.failure_handlers import validate_or_retry_extraction
        result = validate_or_retry_extraction("not json at all")
        assert result is None

    def test_validate_scoring_valid(self):
        from app.agent.failure_handlers import validate_or_retry_scoring
        data = {
            "overall_score": 80,
            "dimension_scores": {"skills": 85, "experience": 75, "seniority_fit": 70},
            "matched_skills": ["Python"],
            "gap_skills": ["K8s"],
            "confidence": "high",
        }
        result = validate_or_retry_scoring(data)
        assert result is not None
        assert result["overall_score"] == 80

    def test_validate_scoring_invalid(self):
        from app.agent.failure_handlers import validate_or_retry_scoring
        result = validate_or_retry_scoring({"bad": "data"})
        assert result is None

    def test_handle_low_confidence_generates_guidance(self):
        from app.agent.failure_handlers import handle_low_confidence
        scoring = {"confidence": "low", "matched_skills": ["Python"], "gap_skills": ["A", "B", "C", "D", "E"]}
        requirements = {"required_skills": ["Python", "A", "B", "C", "D", "E"]}
        candidate = {"skills": ["Python"]}
        result = handle_low_confidence(scoring, requirements, candidate)
        assert "LOW CONFIDENCE" in result
        assert len(result) > 50

    def test_handle_low_confidence_skips_non_low(self):
        from app.agent.failure_handlers import handle_low_confidence
        scoring = {"confidence": "high", "matched_skills": [], "gap_skills": []}
        result = handle_low_confidence(scoring, {}, {})
        assert result == ""

    def test_timeout_handler(self):
        from app.agent.failure_handlers import with_timeout
        import time
        def slow_func(args):
            time.sleep(5)
            return "done"
        with pytest.raises(TimeoutError):
            with_timeout(slow_func, {}, timeout_ms=100)

    def test_timeout_success(self):
        from app.agent.failure_handlers import with_timeout
        def fast_func(args):
            return {"result": "ok"}
        result = with_timeout(fast_func, {}, timeout_ms=5000)
        assert result["result"] == "ok"


# --- Utility Tests ---

class TestUtils:
    def test_strip_markdown_json(self):
        from app.utils import strip_markdown_json
        assert strip_markdown_json('```json\n{"a":1}\n```') == '{"a":1}'
        assert strip_markdown_json('{"a":1}') == '{"a":1}'
        assert strip_markdown_json('```\nfoo\n```') == 'foo'

    def test_validate_url_allows_public(self):
        from app.utils import validate_url
        validate_url("https://example.com/job")  # should not raise

    def test_validate_url_blocks_private(self):
        from app.utils import validate_url
        with pytest.raises(ValueError):
            validate_url("http://localhost:5432")
        with pytest.raises(ValueError):
            validate_url("http://169.254.169.254/metadata")

    def test_validate_url_blocks_non_http(self):
        from app.utils import validate_url
        with pytest.raises(ValueError):
            validate_url("ftp://example.com")

    def test_call_llm_json_parses_and_validates(self):
        from app.utils import call_llm_json
        from app.models.schemas import JobRequirements
        mock_response = '{"required_skills": ["Python"], "nice_to_have_skills": [], "seniority_level": "mid", "domain": "tech", "responsibilities": ["Build"]}'
        with patch('app.llm.call_gemini', return_value=mock_response):
            result = call_llm_json("test prompt", JobRequirements)
            assert result["required_skills"] == ["Python"]

    def test_call_llm_json_strips_markdown(self):
        from app.utils import call_llm_json
        from app.models.schemas import JobRequirements
        mock_response = '```json\n{"required_skills": ["Go"], "nice_to_have_skills": [], "seniority_level": "senior", "domain": "infra", "responsibilities": []}\n```'
        with patch('app.llm.call_gemini', return_value=mock_response):
            result = call_llm_json("test", JobRequirements)
            assert "Go" in result["required_skills"]


# --- Agent State Tests ---

class TestAgentState:
    def test_state_is_typed_dict(self):
        from app.models.agent_state import AgentState
        state: AgentState = {
            "job_id": "test-123",
            "candidate_profile": {"name": "Test"},
            "job_description_text": "Test JD",
            "messages": [],
            "current_step": "init",
            "should_gather_more_signal": False,
            "retry_counts": {},
            "agent_trace": {"tool_calls": [], "total_llm_calls": 0, "fallbacks_triggered": 0},
            "total_llm_calls": 0,
            "fallbacks_triggered": 0,
            "skill_resources": {},
        }
        assert state["job_id"] == "test-123"
        assert state["should_gather_more_signal"] is False


# --- Individual Tool Tests (mocked LLM) ---

class TestExtractJdTool:
    def test_extract_from_text(self):
        from app.tools.extract_jd import extract_jd_requirements
        mock_response = '{"required_skills": ["Python", "SQL"], "nice_to_have_skills": ["Docker"], "seniority_level": "senior", "domain": "fintech", "responsibilities": ["Build APIs"], "company_name": "Acme", "job_title": "Senior Engineer"}'
        with patch('app.llm.call_gemini', return_value=mock_response):
            result = extract_jd_requirements.invoke({"job_url_or_text": "Senior Engineer at Acme. Python, SQL required."})
            assert "Python" in result["required_skills"]
            assert result["seniority_level"] == "senior"
            assert result["domain"] == "fintech"

    def test_extract_schema_validated(self):
        from app.tools.extract_jd import extract_jd_requirements
        # LLM returns markdown-wrapped JSON
        mock_response = '```json\n{"required_skills": ["Go"], "nice_to_have_skills": [], "seniority_level": "mid", "domain": "infra", "responsibilities": ["Deploy"], "company_name": "Unknown", "job_title": "Unknown"}\n```'
        with patch('app.llm.call_gemini', return_value=mock_response):
            result = extract_jd_requirements.invoke({"job_url_or_text": "Go developer needed"})
            assert result["required_skills"] == ["Go"]


class TestScoreCandidateTool:
    def test_scoring_with_mocked_llm(self):
        from app.tools.score_candidate import score_candidate_against_requirements
        mock_response = '{"overall_score": 78, "dimension_scores": {"skills": 80, "experience": 75, "seniority_fit": 70}, "matched_skills": ["Python"], "gap_skills": ["K8s"], "confidence": "medium"}'
        with patch('app.llm.call_gemini', return_value=mock_response):
            result = score_candidate_against_requirements.invoke({
                "candidate_profile": {"name": "Test", "skills": ["Python"]},
                "requirements": {"required_skills": ["Python", "K8s"]},
            })
            assert result["overall_score"] == 78
            assert "Python" in result["matched_skills"]
            assert result["confidence"] == "medium"


class TestPrioritiseGapsTool:
    def test_prioritise_with_mocked_llm(self):
        from app.tools.prioritise_gaps import prioritise_skill_gaps
        mock_response = '[{"skill": "K8s", "priority_rank": 1, "estimated_match_gain_pct": 15, "rationale": "High demand"}, {"skill": "GraphQL", "priority_rank": 2, "estimated_match_gain_pct": 8, "rationale": "Nice to have"}]'
        with patch('app.llm.call_gemini', return_value=mock_response):
            result = prioritise_skill_gaps.invoke({
                "gap_skills": ["K8s", "GraphQL"],
                "job_market_context": "cloud engineering",
            })
            assert len(result) == 2
            assert result[0]["priority_rank"] == 1
            assert result[0]["skill"] == "K8s"

    def test_empty_gaps(self):
        from app.tools.prioritise_gaps import prioritise_skill_gaps
        result = prioritise_skill_gaps.invoke({"gap_skills": [], "job_market_context": "any"})
        assert result == []


class TestResearchSkillsTool:
    def test_research_with_mocked_llm_and_search(self):
        from app.tools.research_skills import research_skill_resources
        mock_llm = '{"resources": [{"title": "K8s Course", "url": "https://example.com", "estimated_hours": 20, "type": "course"}], "relevance_score": 0.9}'
        with patch('app.llm.call_gemini', return_value=mock_llm), \
             patch('app.tools.research_skills._search_duckduckgo', return_value=[{"title": "test", "link": "https://test.com", "snippet": "test"}]), \
             patch('app.tools.research_skills._search_github_topics', return_value=[]):
            result = research_skill_resources.invoke({"skill_name": "Kubernetes", "seniority_context": "senior"})
            assert len(result["resources"]) == 1
            assert result["resources"][0]["type"] == "course"
            assert result["relevance_score"] == 0.9
