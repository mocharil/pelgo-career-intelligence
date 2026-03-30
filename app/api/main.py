"""FastAPI application — API surface for Pelgo career intelligence system."""

from __future__ import annotations

import json
import uuid
from typing import Optional

import structlog

from app.logging_config import setup_logging
setup_logging()
from fastapi import Depends, FastAPI, File, Form, HTTPException, Query, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from pydantic import BaseModel as PydanticBaseModel
from app.config import settings
from app.db.session import AsyncSessionLocal, get_async_session
from app.db.tables import CandidateTable, MatchJobTable
from app.models.schemas import (
    CandidateCreateResponse,
    JobDescriptionInput,
    JobStatus,
    MatchCreateRequest,
    MatchJobResponse,
    MatchListResponse,
)

logger = structlog.get_logger()

app = FastAPI(
    title="Pelgo Career Intelligence API",
    description="Agentic career matching and skill development planning",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# --- Resume Parsing ---

RESUME_PARSE_PROMPT = """Parse this resume into structured data. Return a JSON object with:
- "name": candidate's full name
- "email": email address (or empty string)
- "phone": phone number (or empty string)
- "location": location/city (or empty string)
- "linkedin": LinkedIn URL (or empty string)
- "summary": 2-3 sentence professional summary highlighting their strongest qualities
- "skills": list of technical skills mentioned
- "experiences": list of objects with "title", "company", "duration_years" (float), "description" (include ALL bullet points, achievements, metrics), "skills_used" (list)
- "education": list of objects with "degree", "institution", "field_of_study", "year" (int or null)
- "certifications": list of strings (any certifications, licenses, or professional credentials mentioned)
- "achievements": list of strings (awards, recognitions, notable accomplishments NOT already in experience descriptions)
- "projects": list of objects with "name", "description", "technologies" (list) — side projects, open source, portfolio items
- "languages": list of strings (spoken/written languages mentioned)
- "seniority_level": one of "intern", "junior", "mid", "senior", "staff", "lead", "principal", "director"
- "total_years_experience": float
- "strengths": list of 3-5 key strengths derived from their experience

IMPORTANT: Preserve ALL details from the resume. Do not summarize or omit information. Include exact metrics and numbers from achievements (e.g., "Increased revenue by 40%", "Managed team of 12").

Resume:
{resume_text}

Return ONLY valid JSON, no markdown fences."""


async def _parse_resume(text: str) -> dict:
    """Parse resume text into structured profile using Gemini. Retries on truncated output."""
    from app.llm import call_gemini
    from app.utils import strip_markdown_json

    # Try up to 2 times with increasing max_tokens (some models truncate)
    for attempt, tokens in enumerate([8192, 16384]):
        raw = call_gemini(RESUME_PARSE_PROMPT.format(resume_text=text), max_tokens=tokens)
        raw = strip_markdown_json(raw)
        try:
            return json.loads(raw)
        except json.JSONDecodeError as e:
            logger.warning("resume_parse_json_retry", attempt=attempt + 1, error=str(e), raw_length=len(raw))
            if attempt == 1:
                logger.error("resume_parse_json_error", error=str(e))
                raise HTTPException(status_code=400, detail="Failed to parse resume into structured data. Please try again.")


# --- Dependency ---

async def get_session():
    async with AsyncSessionLocal() as session:
        yield session


# --- Endpoints ---

@app.post("/api/v1/candidate", response_model=CandidateCreateResponse)
async def create_candidate(
    resume_text: Optional[str] = Form(None),
    file: Optional[UploadFile] = File(None),
    session: AsyncSession = Depends(get_session),
):
    """Ingest a candidate resume (PDF or text). Extract and store structured profile."""
    MAX_FILE_SIZE = 10 * 1024 * 1024  # 10 MB

    text = resume_text

    if file:
        content = await file.read(MAX_FILE_SIZE + 1)
        if len(content) > MAX_FILE_SIZE:
            raise HTTPException(status_code=413, detail="File too large (max 10 MB)")
        if file.filename and file.filename.lower().endswith(".pdf"):
            import fitz  # pymupdf
            doc = fitz.open(stream=content, filetype="pdf")
            text = "\n".join(page.get_text() for page in doc)
            doc.close()
        else:
            text = content.decode("utf-8", errors="ignore")

    if not text or not text.strip():
        raise HTTPException(status_code=400, detail="No resume text provided")

    # Parse resume
    parsed = await _parse_resume(text)

    candidate_id = uuid.uuid4()
    candidate = CandidateTable(
        id=candidate_id,
        name=parsed.get("name", "Unknown"),
        email=parsed.get("email", ""),
        summary=parsed.get("summary", ""),
        skills=parsed.get("skills", []),
        experiences=parsed.get("experiences", []),
        education=parsed.get("education", []),
        seniority_level=parsed.get("seniority_level", "mid"),
        total_years_experience=parsed.get("total_years_experience", 0),
    )

    session.add(candidate)
    await session.commit()

    logger.info("candidate_created", id=str(candidate_id), name=candidate.name)

    return CandidateCreateResponse(
        candidate_id=candidate_id,
        name=candidate.name,
        email=candidate.email,
        summary=parsed.get("summary", ""),
        skills=candidate.skills,
        seniority_level=candidate.seniority_level,
        total_years_experience=parsed.get("total_years_experience", 0),
        strengths=parsed.get("strengths", []),
        experiences=parsed.get("experiences", []),
        education=parsed.get("education", []),
    )


@app.put("/api/v1/candidate/{candidate_id}", response_model=CandidateCreateResponse)
async def update_candidate(
    candidate_id: uuid.UUID,
    resume_text: str = Form(...),
    session: AsyncSession = Depends(get_session),
):
    """Re-parse updated resume text and update the candidate profile in DB."""
    candidate = await session.get(CandidateTable, candidate_id)
    if not candidate:
        raise HTTPException(status_code=404, detail="Candidate not found")

    parsed = await _parse_resume(resume_text)

    candidate.name = parsed.get("name", candidate.name)
    candidate.email = parsed.get("email", candidate.email)
    candidate.summary = parsed.get("summary", candidate.summary)
    candidate.skills = parsed.get("skills", candidate.skills)
    candidate.experiences = parsed.get("experiences", candidate.experiences)
    candidate.education = parsed.get("education", candidate.education)
    candidate.seniority_level = parsed.get("seniority_level", candidate.seniority_level)
    candidate.total_years_experience = parsed.get("total_years_experience", candidate.total_years_experience)

    await session.commit()
    logger.info("candidate_updated", id=str(candidate_id), name=candidate.name)

    return CandidateCreateResponse(
        candidate_id=candidate.id,
        name=candidate.name,
        email=candidate.email,
        summary=parsed.get("summary", ""),
        skills=candidate.skills,
        seniority_level=candidate.seniority_level,
        total_years_experience=candidate.total_years_experience,
        strengths=parsed.get("strengths", []),
        experiences=candidate.experiences,
        education=candidate.education,
    )


@app.post("/api/v1/matches")
async def create_matches(
    request: MatchCreateRequest,
    session: AsyncSession = Depends(get_session),
):
    """Accept up to 10 JDs for a candidate. Enqueue agent runs. Return job IDs."""
    # Verify candidate exists
    result = await session.get(CandidateTable, request.candidate_id)
    if not result:
        raise HTTPException(status_code=404, detail="Candidate not found")

    if len(request.job_descriptions) > 10:
        raise HTTPException(status_code=400, detail="Maximum 10 job descriptions per request")

    jobs = []
    for jd in request.job_descriptions:
        if not jd.text and not jd.url:
            raise HTTPException(status_code=400, detail="Each JD must have text or url")

        job_id = uuid.uuid4()
        job = MatchJobTable(
            id=job_id,
            candidate_id=request.candidate_id,
            job_description_text=jd.text or "",
            job_url=jd.url,
            status="pending",
        )
        session.add(job)
        jobs.append({"job_id": str(job_id), "status": "pending"})

    await session.commit()

    # Signal workers via Redis
    from app.utils import signal_workers
    signal_workers([j["job_id"] for j in jobs])

    logger.info("matches_created", candidate_id=str(request.candidate_id), num_jobs=len(jobs))
    return {"jobs": jobs}


@app.get("/api/v1/matches/{match_id}", response_model=MatchJobResponse)
async def get_match(
    match_id: uuid.UUID,
    session: AsyncSession = Depends(get_session),
):
    """Return status and full agent output for one match job."""
    job = await session.get(MatchJobTable, match_id)
    if not job:
        raise HTTPException(status_code=404, detail="Match job not found")

    return MatchJobResponse(
        job_id=job.id,
        status=job.status,
        result=job.result,
        error_detail=job.error_detail,
        agent_trace=job.agent_trace,
        job_description_text=job.job_description_text or None,
        job_url=job.job_url,
        created_at=job.created_at,
        updated_at=job.updated_at,
    )


@app.get("/api/v1/matches", response_model=MatchListResponse)
async def list_matches(
    status: Optional[str] = Query(None),
    candidate_id: Optional[uuid.UUID] = Query(None),
    limit: int = Query(20, ge=1, le=100),
    offset: int = Query(0, ge=0),
    session: AsyncSession = Depends(get_session),
):
    """Paginated list of match jobs, filterable by status and candidate."""
    query = select(MatchJobTable)
    count_query = select(func.count(MatchJobTable.id))

    if status:
        query = query.where(MatchJobTable.status == status)
        count_query = count_query.where(MatchJobTable.status == status)
    if candidate_id:
        query = query.where(MatchJobTable.candidate_id == candidate_id)
        count_query = count_query.where(MatchJobTable.candidate_id == candidate_id)

    query = query.order_by(MatchJobTable.created_at.desc()).offset(offset).limit(limit)

    result = await session.execute(query)
    jobs = result.scalars().all()

    total_result = await session.execute(count_query)
    total = total_result.scalar() or 0

    return MatchListResponse(
        jobs=[
            MatchJobResponse(
                job_id=j.id,
                status=j.status,
                result=j.result,
                error_detail=j.error_detail,
                agent_trace=j.agent_trace,
                job_description_text=j.job_description_text or None,
                job_url=j.job_url,
                created_at=j.created_at,
                updated_at=j.updated_at,
            )
            for j in jobs
        ],
        total=total,
        limit=limit,
        offset=offset,
    )


@app.delete("/api/v1/matches/{match_id}")
async def delete_match(
    match_id: uuid.UUID,
    session: AsyncSession = Depends(get_session),
):
    """Delete a match job."""
    job = await session.get(MatchJobTable, match_id)
    if not job:
        raise HTTPException(status_code=404, detail="Match job not found")
    await session.delete(job)
    await session.commit()
    logger.info("job_deleted", job_id=str(match_id))
    return {"job_id": str(match_id), "deleted": True}


@app.post("/api/v1/matches/{match_id}/requeue")
async def requeue_match(
    match_id: uuid.UUID,
    session: AsyncSession = Depends(get_session),
):
    """Admin endpoint: re-queue a failed job."""
    job = await session.get(MatchJobTable, match_id)
    if not job:
        raise HTTPException(status_code=404, detail="Match job not found")
    if job.status != "failed":
        raise HTTPException(status_code=400, detail="Only failed jobs can be requeued")

    job.status = "pending"
    job.retry_count = 0
    job.error_detail = None
    await session.commit()

    # Signal worker
    from app.utils import signal_workers
    signal_workers([str(match_id)])

    logger.info("job_requeued", job_id=str(match_id))
    return {"job_id": str(match_id), "status": "pending"}


# --- ADK Stretch Endpoint ---

@app.post("/api/v1/adk/extract-jd")
async def adk_extract_jd(jd_text: str = Form(...)):
    """Extract JD requirements using Google ADK agent (stretch goal).

    Demonstrates ADK's tool registration, session management, and event streaming.
    """
    try:
        from app.tools.adk_extract_jd import run_adk_extraction
        result = await run_adk_extraction(jd_text)
        return {"source": "google_adk", "result": result}
    except Exception as e:
        logger.error("adk_extract_failed", error=str(e))
        # Fallback to standard tool
        from app.tools.extract_jd import extract_jd_requirements
        result = extract_jd_requirements.invoke({"job_url_or_text": jd_text})
        return {"source": "fallback_langgraph", "result": result}


# Serve frontend
@app.get("/")
async def serve_frontend():
    return FileResponse("frontend/index.html")


# --- CV AI Improvement ---

class CvImproveRequest(PydanticBaseModel):
    selected_text: str
    context: str = ""
    action: str = "improve"  # improve | shorten | expand | quantify

CV_IMPROVE_PROMPT = """You are a professional CV/resume writer. The user has selected a section of their CV and wants you to {action} it.

SELECTED TEXT:
{selected_text}

SURROUNDING CONTEXT:
{context}

Rules:
- Return ONLY the improved text, no explanations or markdown fences
- Keep the same format (bullet points stay as bullet points, paragraphs stay as paragraphs)
- Use strong action verbs (Led, Built, Designed, Implemented, Architected)
- Add quantifiable metrics where possible (e.g., "Improved performance by 40%")
- Be concise and impactful
- For "shorten": reduce to essential points only
- For "expand": add more detail and context
- For "quantify": add specific numbers, percentages, and metrics
- For "improve": make it more professional, impactful, and ATS-friendly

Return the improved text only."""

@app.post("/api/v1/cv/improve")
async def cv_improve(request: CvImproveRequest):
    """AI-powered CV text improvement."""
    from app.llm import call_gemini
    from app.utils import strip_markdown_json

    action_labels = {
        "improve": "improve and make more professional",
        "shorten": "shorten and make more concise",
        "expand": "expand with more detail",
        "quantify": "add quantifiable metrics to",
    }
    action_desc = action_labels.get(request.action, "improve")

    prompt = CV_IMPROVE_PROMPT.format(
        action=action_desc,
        selected_text=request.selected_text,
        context=request.context[:500],
    )

    try:
        result = call_gemini(prompt, max_tokens=1000)
        result = strip_markdown_json(result)
        return {"improved_text": result.strip(), "action": request.action}
    except Exception as e:
        logger.error("cv_improve_failed", error=str(e))
        raise HTTPException(status_code=500, detail="AI improvement failed. Please try again.")


# --- Cover Letter Generator ---

class CoverLetterRequest(PydanticBaseModel):
    candidate_name: str
    candidate_summary: str = ""
    candidate_skills: list[str] = []
    candidate_experiences: list[dict] = []
    matched_skills: list[str] = []
    gap_skills: list[str] = []
    overall_score: int = 0
    job_description: str = ""
    reasoning: str = ""

COVER_LETTER_PROMPT = """You are an expert career consultant. Write a professional cover letter for a job application.

CANDIDATE:
Name: {name}
Summary: {summary}
Key Skills: {skills}
Recent Experience: {experience}

JOB MATCH ANALYSIS:
Match Score: {score}%
Matched Skills: {matched}
Areas to Grow: {gaps}
AI Assessment: {reasoning}

JOB DESCRIPTION:
{jd}

INSTRUCTIONS:
- Write a compelling, professional cover letter (250-350 words)
- Open with enthusiasm for the specific role and company
- Highlight the matched skills with concrete examples from their experience
- Acknowledge growth areas positively (e.g., "eager to deepen my expertise in...")
- Use a confident but not arrogant tone
- End with a strong closing and call to action
- Do NOT use generic filler phrases like "I am writing to express my interest"
- Make it personal and specific to this candidate-job pairing
- Format as plain text with paragraphs (no markdown, no headers)
- Include "Dear Hiring Manager," at the start and "Sincerely,\\n{name}" at the end

Return ONLY the cover letter text."""

@app.post("/api/v1/cover-letter")
async def generate_cover_letter(request: CoverLetterRequest):
    """Generate a tailored cover letter based on candidate profile and job match."""
    from app.llm import call_gemini

    experience_text = ""
    for exp in request.candidate_experiences[:3]:
        experience_text += f"- {exp.get('title', '')} at {exp.get('company', '')} ({exp.get('duration_years', 0)} yrs): {exp.get('description', '')}\n"

    prompt = COVER_LETTER_PROMPT.format(
        name=request.candidate_name,
        summary=request.candidate_summary,
        skills=", ".join(request.candidate_skills[:15]),
        experience=experience_text,
        score=request.overall_score,
        matched=", ".join(request.matched_skills),
        gaps=", ".join(request.gap_skills),
        reasoning=request.reasoning,
        jd=request.job_description[:2000],
    )

    try:
        result = call_gemini(prompt, max_tokens=1500)
        return {"cover_letter": result.strip()}
    except Exception as e:
        logger.error("cover_letter_failed", error=str(e))
        raise HTTPException(status_code=500, detail="Cover letter generation failed. Please try again.")


# --- Skill Assessment ---

QUIZ_GENERATE_PROMPT = """You are a technical interviewer. Generate a skill assessment quiz for "{skill}" at the {seniority} level.

Create exactly 5 multiple-choice questions that test practical knowledge, not trivia.

Return a JSON object with:
- "skill": the skill name
- "questions": list of 5 objects, each with:
  - "id": integer 1-5
  - "question": the question text (practical, scenario-based when possible)
  - "options": list of exactly 4 strings ["A", "B", "C", "D"]
  - "correct": the correct option letter ("A", "B", "C", or "D")
  - "explanation": one sentence explaining why the correct answer is right

Rules:
- Questions should test PRACTICAL understanding, not memorization
- Include at least 1 scenario/code question and 1 concept question
- Options should be plausible — no obviously wrong answers
- Difficulty should match the seniority level
- For the given seniority level: intern/junior = basics, mid = applied knowledge, senior+ = architecture/tradeoffs

Return ONLY valid JSON, no markdown fences."""

QUIZ_GRADE_PROMPT = """Grade this skill assessment and provide feedback.

SKILL: {skill}
SENIORITY: {seniority}

QUESTIONS AND ANSWERS:
{qa_text}

Return a JSON object with:
- "score": percentage correct (0-100)
- "passed": boolean (true if score >= 60)
- "feedback": 2-3 sentence overall assessment of the candidate's knowledge
- "per_question": list of objects for each question:
  - "id": question number
  - "correct": boolean
  - "explanation": one sentence feedback

Return ONLY valid JSON, no markdown fences."""


class QuizGenerateRequest(PydanticBaseModel):
    skill: str
    seniority: str = "mid"

class QuizAnswer(PydanticBaseModel):
    question_id: int
    answer: str  # "A", "B", "C", or "D"

class QuizGradeRequest(PydanticBaseModel):
    skill: str
    seniority: str = "mid"
    questions: list[dict]  # the original questions
    answers: list[QuizAnswer]


@app.post("/api/v1/assessment/generate")
async def generate_assessment(request: QuizGenerateRequest):
    """Generate a skill assessment quiz."""
    from app.llm import call_gemini
    from app.utils import strip_markdown_json

    try:
        raw = call_gemini(
            QUIZ_GENERATE_PROMPT.format(skill=request.skill, seniority=request.seniority),
            max_tokens=2000,
        )
        raw = strip_markdown_json(raw)
        return json.loads(raw)
    except Exception as e:
        logger.error("quiz_generate_failed", error=str(e))
        raise HTTPException(status_code=500, detail="Quiz generation failed.")


@app.post("/api/v1/assessment/grade")
async def grade_assessment(request: QuizGradeRequest):
    """Grade a skill assessment quiz."""
    # Quick grade: compare answers with correct answers from questions
    results = []
    correct_count = 0
    qa_lines = []

    for ans in request.answers:
        q = next((q for q in request.questions if q["id"] == ans.question_id), None)
        if not q:
            continue
        is_correct = ans.answer.upper() == q.get("correct", "").upper()
        if is_correct:
            correct_count += 1
        results.append({
            "id": ans.question_id,
            "correct": is_correct,
            "your_answer": ans.answer,
            "correct_answer": q.get("correct", ""),
            "explanation": q.get("explanation", ""),
        })
        qa_lines.append(f"Q{ans.question_id}: {q['question']}\nYour answer: {ans.answer} | Correct: {q.get('correct', '')}")

    score = round((correct_count / max(len(request.answers), 1)) * 100)
    passed = score >= 60

    # Generate AI feedback
    feedback = f"You scored {score}% ({correct_count}/{len(request.answers)} correct)."
    try:
        from app.llm import call_gemini
        from app.utils import strip_markdown_json
        raw = call_gemini(
            QUIZ_GRADE_PROMPT.format(
                skill=request.skill,
                seniority=request.seniority,
                qa_text="\n".join(qa_lines),
            ),
            max_tokens=500,
        )
        raw = strip_markdown_json(raw)
        parsed = json.loads(raw)
        feedback = parsed.get("feedback", feedback)
    except Exception:
        pass

    return {
        "skill": request.skill,
        "score": score,
        "passed": passed,
        "feedback": feedback,
        "results": results,
    }


# --- CV Markdown Generation ---

CV_GENERATE_PROMPT = """You are a professional CV writer. Convert this candidate profile data into a polished Markdown CV.

CANDIDATE DATA (JSON):
{candidate_json}

RULES:
- Use proper Markdown: # for name, ## for sections, ### for job titles, - for bullet points, **bold** for emphasis
- Include ALL sections that have data: Summary, Skills, Experience, Education, Certifications, Achievements, Projects, Languages
- For Experience: include company name, duration, ALL bullet points/descriptions exactly as provided. Do NOT summarize or omit details.
- Preserve exact metrics and numbers (e.g., "Increased revenue by 40%", "Led team of 12 engineers")
- Skills section: list all skills separated by " · "
- Contact info (email, phone, location, linkedin) on lines right after the name
- Make it ATS-friendly and professional
- Do NOT add information that is not in the data
- Do NOT add generic filler text

Return ONLY the Markdown text, no code fences."""

@app.post("/api/v1/cv/generate-markdown")
async def generate_cv_markdown(
    candidate_id: uuid.UUID = Form(...),
    session: AsyncSession = Depends(get_session),
):
    """Generate a polished Markdown CV from candidate profile data."""
    from app.llm import call_gemini

    candidate = await session.get(CandidateTable, candidate_id)
    if not candidate:
        raise HTTPException(status_code=404, detail="Candidate not found")

    # Build full profile dict with all available fields
    profile = {
        "name": candidate.name,
        "email": candidate.email,
        "summary": candidate.summary,
        "skills": candidate.skills,
        "experiences": candidate.experiences,
        "education": candidate.education,
        "seniority_level": candidate.seniority_level,
        "total_years_experience": candidate.total_years_experience,
    }

    try:
        result = call_gemini(
            CV_GENERATE_PROMPT.format(candidate_json=json.dumps(profile, indent=2)),
            max_tokens=3000,
        )
        # Strip any accidental markdown fences
        from app.utils import strip_markdown_json
        if result.startswith("```"):
            result = strip_markdown_json(result)
        return {"markdown": result.strip()}
    except Exception as e:
        logger.error("cv_generate_failed", error=str(e))
        raise HTTPException(status_code=500, detail="CV generation failed.")


# --- Company Profile ---

COMPANY_PROFILE_PROMPT = """You are a company research analyst. Given a job description, extract the company name and provide a brief company profile.

JOB DESCRIPTION:
{jd_text}

Return a JSON object with:
- "company_name": the company name (or "Unknown" if not identifiable)
- "industry": the company's industry/sector
- "size_estimate": estimated company size ("startup", "small", "medium", "large", "enterprise")
- "culture_signals": list of 3-5 culture indicators detected from the JD (e.g., "remote-friendly", "fast-paced", "collaborative", "innovation-driven")
- "pros": list of 3 potential pros of working there based on the JD
- "cons": list of 2 potential concerns or things to verify
- "summary": 2-3 sentence company overview based on what can be inferred from the JD

Be honest — if the JD doesn't mention the company name, say "Unknown". Base analysis ONLY on information in the JD, don't fabricate details.
Return ONLY valid JSON, no markdown fences."""

@app.post("/api/v1/company-profile")
async def get_company_profile(jd_text: str = Form(...)):
    """Extract company profile from a job description."""
    from app.llm import call_gemini
    from app.utils import strip_markdown_json

    try:
        raw = call_gemini(COMPANY_PROFILE_PROMPT.format(jd_text=jd_text[:3000]), max_tokens=1000)
        raw = strip_markdown_json(raw)
        parsed = json.loads(raw)
        return parsed
    except Exception as e:
        logger.error("company_profile_failed", error=str(e))
        raise HTTPException(status_code=500, detail="Company profile extraction failed.")


# Health check
@app.get("/health")
async def health():
    return {"status": "ok"}
