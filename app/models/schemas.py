"""Pydantic models for all data types in the Pelgo career intelligence system."""

from __future__ import annotations

import uuid
from datetime import datetime
from enum import Enum
from typing import Optional

from pydantic import BaseModel, Field


# --- Enums ---

class SeniorityLevel(str, Enum):
    INTERN = "intern"
    JUNIOR = "junior"
    MID = "mid"
    SENIOR = "senior"
    STAFF = "staff"
    LEAD = "lead"
    PRINCIPAL = "principal"
    DIRECTOR = "director"


class Confidence(str, Enum):
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"


class ResourceType(str, Enum):
    COURSE = "course"
    PROJECT = "project"
    CERT = "cert"
    DOC = "doc"


class JobStatus(str, Enum):
    PENDING = "pending"
    PROCESSING = "processing"
    COMPLETED = "completed"
    FAILED = "failed"


# --- Candidate Profile ---

class WorkExperience(BaseModel):
    title: str
    company: str
    duration_years: float = 0.0
    description: str = ""
    skills_used: list[str] = Field(default_factory=list)


class Education(BaseModel):
    degree: str
    institution: str
    field_of_study: str = ""
    year: Optional[int] = None


class CandidateProfile(BaseModel):
    id: uuid.UUID = Field(default_factory=uuid.uuid4)
    name: str
    email: str = ""
    summary: str = ""
    skills: list[str] = Field(default_factory=list)
    experiences: list[WorkExperience] = Field(default_factory=list)
    education: list[Education] = Field(default_factory=list)
    seniority_level: SeniorityLevel = SeniorityLevel.MID
    total_years_experience: float = 0.0
    created_at: datetime = Field(default_factory=datetime.utcnow)


# --- Job Requirements (Tool 1 output) ---

class JobRequirements(BaseModel):
    required_skills: list[str] = Field(default_factory=list)
    nice_to_have_skills: list[str] = Field(default_factory=list)
    seniority_level: SeniorityLevel = SeniorityLevel.MID
    domain: Optional[str] = ""
    responsibilities: list[str] = Field(default_factory=list)
    company_name: Optional[str] = "Unknown"
    job_title: Optional[str] = "Unknown"

    def __init__(self, **data):
        if data.get("domain") is None:
            data["domain"] = ""
        super().__init__(**data)


# --- Scoring Result (Tool 2 output) ---

class DimensionScores(BaseModel):
    """Dimension scores — accepts floats from LLM, coerces to int, clamps 0-100."""

    skills: int = Field(ge=0, le=100)
    experience: int = Field(ge=0, le=100)
    seniority_fit: int = Field(ge=0, le=100)

    @staticmethod
    def _clamp(value: Any) -> int:
        """Round floats and clamp to 0-100."""
        if isinstance(value, float):
            value = round(value)
        return max(0, min(100, int(value)))

    def __init__(self, **data):
        for key in ("skills", "experience", "seniority_fit"):
            if key in data:
                data[key] = DimensionScores._clamp(data[key])
        super().__init__(**data)


class ScoringResult(BaseModel):
    overall_score: int = Field(ge=0, le=100)
    dimension_scores: DimensionScores
    matched_skills: list[str] = Field(default_factory=list)
    gap_skills: list[str] = Field(default_factory=list)
    confidence: Confidence = Confidence.MEDIUM

    def __init__(self, **data):
        if "overall_score" in data and isinstance(data["overall_score"], float):
            data["overall_score"] = round(data["overall_score"])
        super().__init__(**data)


# --- Skill Resource (Tool 3 output) ---

class SkillResource(BaseModel):
    title: str
    url: str
    estimated_hours: float = 0.0
    type: ResourceType = ResourceType.COURSE


class SkillResourceResult(BaseModel):
    resources: list[SkillResource] = Field(default_factory=list)
    relevance_score: float = Field(ge=0.0, le=1.0, default=0.5)


# --- Prioritised Skill (Tool 4 output) ---

class PrioritisedSkill(BaseModel):
    skill: str
    priority_rank: int
    estimated_match_gain_pct: float
    rationale: str


# --- Agent Trace ---

class ToolCallTrace(BaseModel):
    tool: str
    status: str  # "success" | "error" | "timeout"
    latency_ms: int = 0
    error: Optional[str] = None


class AgentTrace(BaseModel):
    tool_calls: list[ToolCallTrace] = Field(default_factory=list)
    total_llm_calls: int = 0
    fallbacks_triggered: int = 0


# --- Learning Plan Entry ---

class LearningPlanEntry(BaseModel):
    skill: str
    priority_rank: int
    estimated_match_gain_pct: float
    resources: list[SkillResource] = Field(default_factory=list)
    rationale: str


# --- Final Agent Output (A3 Schema) ---

class MatchResult(BaseModel):
    job_id: uuid.UUID
    overall_score: int = Field(ge=0, le=100)
    confidence: Confidence
    dimension_scores: DimensionScores
    matched_skills: list[str] = Field(default_factory=list)
    gap_skills: list[str] = Field(default_factory=list)
    reasoning: str
    learning_plan: list[LearningPlanEntry] = Field(default_factory=list)
    agent_trace: AgentTrace

    def __init__(self, **data):
        if "overall_score" in data and isinstance(data["overall_score"], float):
            data["overall_score"] = round(data["overall_score"])
        super().__init__(**data)


# --- API Request/Response Models ---

class CandidateCreateRequest(BaseModel):
    resume_text: Optional[str] = None


class CandidateCreateResponse(BaseModel):
    candidate_id: uuid.UUID
    name: str
    email: str = ""
    summary: str = ""
    skills: list[str]
    seniority_level: SeniorityLevel
    total_years_experience: float = 0.0
    strengths: list[str] = Field(default_factory=list)
    experiences: list[WorkExperience] = Field(default_factory=list)
    education: list[Education] = Field(default_factory=list)


class JobDescriptionInput(BaseModel):
    text: Optional[str] = None
    url: Optional[str] = None


class MatchCreateRequest(BaseModel):
    candidate_id: uuid.UUID
    job_descriptions: list[JobDescriptionInput] = Field(max_length=10)


class MatchJobResponse(BaseModel):
    job_id: uuid.UUID
    status: JobStatus
    result: Optional[MatchResult] = None
    error_detail: Optional[str] = None
    agent_trace: Optional[dict] = None  # Partial trace during processing
    job_description_text: Optional[str] = None
    job_url: Optional[str] = None
    created_at: datetime
    updated_at: Optional[datetime] = None


class MatchListResponse(BaseModel):
    jobs: list[MatchJobResponse]
    total: int
    limit: int
    offset: int
