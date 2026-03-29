"""Integration test — full lifecycle: ingest candidate → submit JD → agent runs → validate result.

Run with: pytest tests/test_integration.py -v
Requires: docker-compose stack running (API on localhost:8000)
"""

import time
import uuid

import httpx
import pytest

import os
BASE_URL = os.environ.get("TEST_API_URL", "http://localhost:8001")
POLL_INTERVAL = 3
MAX_POLL_ATTEMPTS = 40  # 2 minutes max


SAMPLE_RESUME = """
Sarah Chen
Email: sarah.chen@example.com

SUMMARY
Full-stack software engineer with 5 years of experience building web applications.
Strong background in Python, React, and cloud infrastructure.

SKILLS
Python, JavaScript, TypeScript, React, Node.js, PostgreSQL, Redis, Docker, AWS,
Git, REST APIs, FastAPI, Django, HTML/CSS, CI/CD

EXPERIENCE
Software Engineer — TechCorp Inc. (2021–2024)
- Built and maintained microservices handling 10K req/s
- Led migration from monolith to microservices architecture
- Technologies: Python, FastAPI, PostgreSQL, Docker, AWS

Junior Developer — StartupXYZ (2019–2021)
- Developed customer-facing React dashboards
- Implemented REST APIs and integrated payment systems
- Technologies: JavaScript, React, Node.js, PostgreSQL

EDUCATION
B.Sc. Computer Science — University of Melbourne (2019)
"""

SAMPLE_JD = """
Senior Full-Stack Engineer — FinTech Platform

Requirements:
- 5+ years of experience in software engineering
- Strong proficiency in Python and TypeScript
- Experience with React and modern frontend frameworks
- Solid understanding of PostgreSQL and database design
- Experience with cloud platforms (AWS or GCP)
- Knowledge of containerization (Docker, Kubernetes)
- Experience with CI/CD pipelines

Nice to Have:
- Experience with GraphQL
- Knowledge of Kubernetes
- Experience with event-driven architectures (Kafka, RabbitMQ)

Responsibilities:
- Design and implement scalable backend services
- Build responsive frontend interfaces
- Mentor junior engineers
"""


@pytest.fixture(scope="module")
def client():
    return httpx.Client(base_url=BASE_URL, timeout=60)


def test_health(client):
    """API is reachable."""
    resp = client.get("/health")
    assert resp.status_code == 200
    assert resp.json()["status"] == "ok"


def test_full_lifecycle(client):
    """Full lifecycle: create candidate → submit JD → poll → validate result."""

    # Step 1: Ingest candidate
    resp = client.post(
        "/api/v1/candidate",
        data={"resume_text": SAMPLE_RESUME},
    )
    assert resp.status_code == 200, f"Candidate creation failed: {resp.text}"
    candidate = resp.json()
    candidate_id = candidate["candidate_id"]
    assert candidate["name"]  # Name was extracted
    assert len(candidate["skills"]) > 0  # Skills were extracted
    print(f"Created candidate: {candidate['name']} ({candidate_id})")

    # Step 2: Submit JD for matching
    resp = client.post(
        "/api/v1/matches",
        json={
            "candidate_id": candidate_id,
            "job_descriptions": [{"text": SAMPLE_JD}],
        },
    )
    assert resp.status_code == 200, f"Match creation failed: {resp.text}"
    jobs = resp.json()["jobs"]
    assert len(jobs) == 1
    job_id = jobs[0]["job_id"]
    assert jobs[0]["status"] == "pending"
    print(f"Created match job: {job_id}")

    # Step 3: Poll for completion
    result = None
    for attempt in range(MAX_POLL_ATTEMPTS):
        resp = client.get(f"/api/v1/matches/{job_id}")
        assert resp.status_code == 200
        data = resp.json()
        status = data["status"]
        print(f"  Poll {attempt + 1}: status={status}")

        if status == "completed":
            result = data["result"]
            break
        elif status == "failed":
            pytest.fail(f"Job failed: {data.get('error_detail', 'unknown')}")
        time.sleep(POLL_INTERVAL)

    assert result is not None, "Job did not complete within timeout"

    # Step 4: Validate result matches A3 schema
    assert "job_id" in result
    assert 0 <= result["overall_score"] <= 100
    assert result["confidence"] in ("low", "medium", "high")

    # Dimension scores
    ds = result["dimension_scores"]
    assert 0 <= ds["skills"] <= 100
    assert 0 <= ds["experience"] <= 100
    assert 0 <= ds["seniority_fit"] <= 100

    # Skills
    assert isinstance(result["matched_skills"], list)
    assert isinstance(result["gap_skills"], list)
    assert len(result["matched_skills"]) > 0  # Should match some skills

    # Reasoning
    assert len(result["reasoning"]) > 10

    # Learning plan
    assert isinstance(result["learning_plan"], list)
    if result["gap_skills"]:
        assert len(result["learning_plan"]) > 0
        plan_entry = result["learning_plan"][0]
        assert "skill" in plan_entry
        assert "priority_rank" in plan_entry
        assert "resources" in plan_entry
        assert "rationale" in plan_entry

    # Agent trace — MUST be real, not fabricated
    trace = result["agent_trace"]
    assert "tool_calls" in trace
    assert isinstance(trace["tool_calls"], list)
    assert len(trace["tool_calls"]) >= 2  # At least extract + score
    assert "total_llm_calls" in trace
    assert trace["total_llm_calls"] >= 1

    # Verify tool calls have real data
    for tc in trace["tool_calls"]:
        assert "tool" in tc
        assert "status" in tc
        assert "latency_ms" in tc
        assert tc["latency_ms"] > 0  # Real latency, not zero
        assert tc["tool"] in (
            "extract_jd_requirements",
            "score_candidate_against_requirements",
            "research_skill_resources",
            "prioritise_skill_gaps",
        )

    print(f"\nResult validated successfully!")
    print(f"  Score: {result['overall_score']}/100 ({result['confidence']} confidence)")
    print(f"  Matched: {result['matched_skills']}")
    print(f"  Gaps: {result['gap_skills']}")
    print(f"  Learning plan: {len(result['learning_plan'])} entries")
    print(f"  Tool calls: {len(trace['tool_calls'])}")
    print(f"  LLM calls: {trace['total_llm_calls']}")


def test_list_matches_pagination(client):
    """GET /api/v1/matches supports pagination and filtering."""
    resp = client.get("/api/v1/matches", params={"limit": 5, "offset": 0})
    assert resp.status_code == 200
    data = resp.json()
    assert "jobs" in data
    assert "total" in data
    assert "limit" in data
    assert data["limit"] == 5
    assert data["offset"] == 0


def test_match_not_found(client):
    """GET /api/v1/matches/{id} returns 404 for unknown ID."""
    fake_id = str(uuid.uuid4())
    resp = client.get(f"/api/v1/matches/{fake_id}")
    assert resp.status_code == 404


def test_candidate_not_found_for_match(client):
    """POST /api/v1/matches returns 404 for unknown candidate."""
    resp = client.post(
        "/api/v1/matches",
        json={
            "candidate_id": str(uuid.uuid4()),
            "job_descriptions": [{"text": "Some JD"}],
        },
    )
    assert resp.status_code == 404
