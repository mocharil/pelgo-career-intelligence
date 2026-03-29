"""Initial schema - candidates and match_jobs tables.

Revision ID: 001
Revises: None
Create Date: 2026-03-28
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "001"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Candidates table
    op.create_table(
        "candidates",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True,
                  server_default=sa.text("gen_random_uuid()")),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("email", sa.String(255), server_default=""),
        sa.Column("summary", sa.Text(), server_default=""),
        sa.Column("skills", postgresql.JSONB(), nullable=False,
                  server_default=sa.text("'[]'::jsonb")),
        sa.Column("experiences", postgresql.JSONB(), nullable=False,
                  server_default=sa.text("'[]'::jsonb")),
        sa.Column("education", postgresql.JSONB(), nullable=False,
                  server_default=sa.text("'[]'::jsonb")),
        sa.Column("seniority_level", sa.String(50), server_default="mid"),
        sa.Column("total_years_experience", sa.Float(), server_default="0.0"),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.now()),
    )

    # Match jobs table
    op.create_table(
        "match_jobs",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True,
                  server_default=sa.text("gen_random_uuid()")),
        sa.Column("candidate_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("candidates.id"), nullable=False),
        sa.Column("job_description_text", sa.Text(), server_default=""),
        sa.Column("job_url", sa.String(2048), nullable=True),
        sa.Column("status", sa.String(20), nullable=False, server_default="pending"),
        sa.Column("result", postgresql.JSONB(), nullable=True),
        sa.Column("agent_trace", postgresql.JSONB(), nullable=True),
        sa.Column("error_detail", sa.Text(), nullable=True),
        sa.Column("retry_count", sa.Integer(), server_default="0"),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(), server_default=sa.func.now()),
    )

    # Indexes for querying
    op.create_index("ix_match_jobs_candidate_id", "match_jobs", ["candidate_id"])
    op.create_index("ix_match_jobs_status", "match_jobs", ["status"])


def downgrade() -> None:
    op.drop_index("ix_match_jobs_status")
    op.drop_index("ix_match_jobs_candidate_id")
    op.drop_table("match_jobs")
    op.drop_table("candidates")
