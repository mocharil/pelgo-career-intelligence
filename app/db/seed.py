"""Seed script — idempotent, inserts sample candidate and job descriptions."""

import uuid
import sys
import os

# Allow running as module from project root
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(__file__))))

from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session

from app.config import settings
from app.db.tables import Base, CandidateTable, MatchJobTable

# Fixed UUIDs so the script is idempotent
CANDIDATE_ID = uuid.UUID("a1b2c3d4-e5f6-7890-abcd-ef1234567890")
JOB_1_ID = uuid.UUID("b1b2c3d4-e5f6-7890-abcd-ef1234567891")
JOB_2_ID = uuid.UUID("b1b2c3d4-e5f6-7890-abcd-ef1234567892")

SAMPLE_CANDIDATE = {
    "id": CANDIDATE_ID,
    "name": "Sarah Chen",
    "email": "sarah.chen@example.com",
    "summary": (
        "Full-stack software engineer with 5 years of experience building web "
        "applications. Strong background in Python, React, and cloud infrastructure. "
        "Led a team of 3 engineers to deliver a real-time analytics dashboard. "
        "Looking to transition into a senior engineering or tech lead role."
    ),
    "skills": [
        "Python", "JavaScript", "TypeScript", "React", "Node.js",
        "PostgreSQL", "Redis", "Docker", "AWS", "Git",
        "REST APIs", "FastAPI", "Django", "HTML/CSS", "CI/CD",
    ],
    "experiences": [
        {
            "title": "Software Engineer",
            "company": "TechCorp Inc.",
            "duration_years": 3.0,
            "description": (
                "Built and maintained microservices handling 10K req/s. "
                "Led migration from monolith to microservices architecture. "
                "Mentored 2 junior engineers."
            ),
            "skills_used": ["Python", "FastAPI", "PostgreSQL", "Docker", "AWS"],
        },
        {
            "title": "Junior Developer",
            "company": "StartupXYZ",
            "duration_years": 2.0,
            "description": (
                "Developed customer-facing React dashboards. "
                "Implemented REST APIs and integrated third-party payment systems."
            ),
            "skills_used": ["JavaScript", "React", "Node.js", "PostgreSQL"],
        },
    ],
    "education": [
        {
            "degree": "B.Sc. Computer Science",
            "institution": "University of Melbourne",
            "field_of_study": "Computer Science",
            "year": 2019,
        }
    ],
    "seniority_level": "mid",
    "total_years_experience": 5.0,
}

SAMPLE_JOB_1 = {
    "id": JOB_1_ID,
    "candidate_id": CANDIDATE_ID,
    "job_description_text": """
Senior Full-Stack Engineer — FinTech Platform

About Us:
We are a fast-growing fintech startup building the next generation of payment infrastructure.

Requirements:
- 5+ years of experience in software engineering
- Strong proficiency in Python and TypeScript
- Experience with React and modern frontend frameworks
- Solid understanding of PostgreSQL and database design
- Experience with cloud platforms (AWS or GCP)
- Knowledge of containerization (Docker, Kubernetes)
- Experience with CI/CD pipelines
- Strong understanding of RESTful API design

Nice to Have:
- Experience with GraphQL
- Knowledge of Kubernetes and container orchestration
- Experience with event-driven architectures (Kafka, RabbitMQ)
- Familiarity with financial systems or payment processing

Responsibilities:
- Design and implement scalable backend services
- Build responsive and performant frontend interfaces
- Collaborate with product and design teams
- Mentor junior engineers and conduct code reviews
- Participate in on-call rotation
""",
    "job_url": None,
    "status": "pending",
}

SAMPLE_JOB_2 = {
    "id": JOB_2_ID,
    "candidate_id": CANDIDATE_ID,
    "job_description_text": """
Machine Learning Engineer — AI Healthcare Company

About Us:
We use AI to improve patient outcomes through predictive diagnostics.

Requirements:
- 3+ years of experience in machine learning engineering
- Strong proficiency in Python and ML frameworks (PyTorch, TensorFlow)
- Experience with NLP and transformer architectures
- Knowledge of MLOps (MLflow, Kubeflow, or similar)
- Experience deploying ML models to production
- Strong statistics and mathematics background
- Experience with large-scale data processing (Spark, Dask)

Nice to Have:
- PhD in Computer Science, Statistics, or related field
- Experience with medical/healthcare data
- Knowledge of HIPAA compliance
- Publications in ML/AI conferences

Responsibilities:
- Develop and train ML models for clinical prediction
- Build ML pipelines for model training and serving
- Collaborate with clinical researchers on model validation
- Monitor model performance and implement retraining strategies
""",
    "job_url": None,
    "status": "pending",
}


def seed():
    engine = create_engine(settings.database_url_sync)

    with Session(engine) as session:
        # Check if candidate already exists
        existing = session.get(CandidateTable, CANDIDATE_ID)
        if existing:
            print("Seed data already exists. Skipping.")
            return

        # Insert candidate
        candidate = CandidateTable(**SAMPLE_CANDIDATE)
        session.add(candidate)

        # Insert job descriptions
        job1 = MatchJobTable(**SAMPLE_JOB_1)
        job2 = MatchJobTable(**SAMPLE_JOB_2)
        session.add(job1)
        session.add(job2)

        session.commit()
        print(f"Seeded candidate: {SAMPLE_CANDIDATE['name']} ({CANDIDATE_ID})")
        print(f"Seeded job 1: Senior Full-Stack Engineer ({JOB_1_ID})")
        print(f"Seeded job 2: ML Engineer ({JOB_2_ID})")
        print("Seed complete.")


if __name__ == "__main__":
    seed()
