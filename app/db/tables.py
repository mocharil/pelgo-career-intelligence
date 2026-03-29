"""SQLAlchemy table definitions for PostgreSQL."""

import uuid
from datetime import datetime

from sqlalchemy import (
    Column,
    DateTime,
    Enum,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import DeclarativeBase, relationship


class Base(DeclarativeBase):
    pass


class CandidateTable(Base):
    __tablename__ = "candidates"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name = Column(String(255), nullable=False)
    email = Column(String(255), default="")
    summary = Column(Text, default="")
    skills = Column(JSONB, nullable=False, default=list)
    experiences = Column(JSONB, nullable=False, default=list)
    education = Column(JSONB, nullable=False, default=list)
    seniority_level = Column(String(50), default="mid")
    total_years_experience = Column(Float, default=0.0)
    created_at = Column(DateTime, default=datetime.utcnow)

    # Relationship
    match_jobs = relationship("MatchJobTable", back_populates="candidate")


class MatchJobTable(Base):
    __tablename__ = "match_jobs"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    candidate_id = Column(
        UUID(as_uuid=True), ForeignKey("candidates.id"), nullable=False
    )
    job_description_text = Column(Text, default="")
    job_url = Column(String(2048), nullable=True)
    status = Column(
        String(20),
        nullable=False,
        default="pending",
    )
    result = Column(JSONB, nullable=True)
    agent_trace = Column(JSONB, nullable=True)
    error_detail = Column(Text, nullable=True)
    retry_count = Column(Integer, default=0)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    # Relationship
    candidate = relationship("CandidateTable", back_populates="match_jobs")

    # Indexes
    __table_args__ = (
        Index("ix_match_jobs_candidate_id", "candidate_id"),
        Index("ix_match_jobs_status", "status"),
    )
