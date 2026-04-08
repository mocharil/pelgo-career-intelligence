# Pelgo Career Intelligence System — Complete Application Context

> This document provides full context for any AI assistant to understand the entire Pelgo application:
> its architecture, codebase, data flow, design decisions, and operational details.

---

## 1. What This App Does

Pelgo is an **agentic career-matching system**. It:
1. Accepts a candidate's resume (PDF or text)
2. Parses it into a structured profile using AI (Gemini)
3. Accepts 1-10 job descriptions (text or URL)
4. Runs an autonomous AI agent (LangGraph) that:
   - Extracts structured requirements from each JD
   - Scores the candidate against those requirements (multi-dimensional)
   - Prioritises skill gaps by market impact
   - Researches real learning resources for top gaps
5. Returns a match score, confidence level, and personalized learning plan
6. All processing happens asynchronously via background workers

---

## 2. Tech Stack

| Layer | Technology |
|-------|-----------|
| **Backend API** | Python 3.12, FastAPI, Uvicorn |
| **Agent Orchestration** | LangGraph (LangChain-based state graph) |
| **LLM** | Google Gemini 2.5 Flash Lite via Vertex AI |
| **Database** | PostgreSQL 16 (async via asyncpg, ORM via SQLAlchemy) |
| **Cache/Signaling** | Redis 7 (job notification only, not job state) |
| **Migrations** | Alembic |
| **Frontend** | React 19 + TypeScript + Tailwind CSS v4 + Vite |
| **Reverse Proxy** | Nginx (serves React SPA, proxies `/api/*` to backend) |
| **Containerization** | Docker Compose (5 containers) |
| **Logging** | structlog (structured, JSON-capable) |
| **Validation** | Pydantic v2 throughout |
| **PDF Parsing** | PyMuPDF (fitz) |
| **Web Scraping** | httpx + BeautifulSoup (lxml) |

---

## 3. Project Structure

```
Pelgo/
├── app/                              # Backend Python application
│   ├── agent/
│   │   ├── graph.py                  # LangGraph orchestrator (690 lines) — state machine, 4 tools, routing
│   │   └── failure_handlers.py       # 3 failure modes: timeout, invalid output, low confidence
│   │
│   ├── tools/                        # 4 AI-powered tools (LangChain @tool decorated)
│   │   ├── extract_jd.py             # Tool 1: Parse JD → structured requirements
│   │   ├── score_candidate.py        # Tool 2: Multi-dimension scoring (skills/exp/seniority)
│   │   ├── research_skills.py        # Tool 3: Real external search (DuckDuckGo + GitHub API)
│   │   ├── prioritise_gaps.py        # Tool 4: Rank skill gaps by impact
│   │   └── adk_extract_jd.py         # Google ADK stretch implementation
│   │
│   ├── api/
│   │   └── main.py                   # FastAPI app: 15 endpoints
│   │
│   ├── worker/
│   │   └── main.py                   # Background job processor (race-safe via PostgreSQL)
│   │
│   ├── db/
│   │   ├── tables.py                 # SQLAlchemy ORM: candidates, match_jobs
│   │   ├── session.py                # Async + sync session factories
│   │   └── seed.py                   # Idempotent sample data (fixed UUIDs)
│   │
│   ├── models/
│   │   ├── schemas.py                # All Pydantic models (MatchResult, AgentTrace, etc.)
│   │   └── agent_state.py            # TypedDict state for LangGraph
│   │
│   ├── config.py                     # pydantic-settings from .env
│   ├── llm.py                        # Vertex AI / Gemini wrapper (call_gemini, token logging)
│   ├── utils.py                      # SSRF validation, JSON parsing, Redis signaling
│   └── logging_config.py             # structlog setup
│
├── frontend/                         # React SPA
│   ├── src/
│   │   ├── pages/                    # 9 pages
│   │   ├── components/shared/        # 13 design system components
│   │   ├── layouts/                  # DashboardShell, SideNav, TopNav
│   │   ├── context/                  # CandidateContext, ThemeContext
│   │   └── lib/
│   │       ├── api.ts                # Typed API client
│   │       └── skills.ts             # Skill verification helpers
│   ├── Dockerfile                    # Multi-stage: Node 20 → Nginx Alpine
│   └── nginx.conf                    # Reverse proxy config
│
├── alembic/                          # Database migrations
│   └── versions/001_initial_schema.py
│
├── tests/
│   ├── test_tools.py                 # 31 unit tests (mocked LLM)
│   └── test_integration.py           # 5 integration tests (full lifecycle)
│
├── docker-compose.yml                # Full stack: postgres, redis, api, worker-1, worker-2, frontend
├── Dockerfile                        # Backend container (Python 3.12)
├── requirements.txt                  # 26 Python packages
├── .env.example                      # Environment template
└── README.md                         # Full documentation (26KB)
```

---

## 4. Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│                         FRONTEND (React + Nginx)                   │
│                         Port 3000                                  │
│  ┌─────────────┐ ┌──────────────┐ ┌────────────┐ ┌──────────────┐  │
│  │  Onboarding │ │  Dashboard   │ │ Job Detail │ │ Learning Path│  │
│  │  (Resume)   │ │  (All Jobs)  │ │ (Scores)   │ │ (Resources)  │  │
│  └──────┬──────┘ └──────┬───────┘ └─────┬──────┘ └──────┬───────┘  │
│         │               │               │               │          │
│         └───────────────┴───────────────┴───────────────┘          │
│                              │ Nginx proxies /api/* │               │
└──────────────────────────────┼──────────────────────┼──────────────┘
                               │                      │
┌──────────────────────────────▼──────────────────────▼──────────────┐
│                      FASTAPI (Backend API)                         │
│                      Port 8000                                     │
│                                                                    │
│  POST /api/v1/candidate     → Parse resume → Save to PostgreSQL    │
│  POST /api/v1/matches       → Create jobs → Signal Redis           │
│  GET  /api/v1/matches/{id}  → Return status + result               │
│  GET  /api/v1/matches       → Paginated list (filter by status)    │
│  POST /api/v1/cv/improve    → AI text revision                     │
│  POST /api/v1/cover-letter  → Generate tailored cover letter       │
│  POST /api/v1/assessment/*  → Skill quiz generation + grading      │
│  ...and more (15 total)                                            │
└────────────────┬──────────────────────────────┬────────────────────┘
                 │                              │
      ┌──────────▼──────────┐        ┌──────────▼──────────┐
      │    PostgreSQL 16    │        │      Redis 7        │
      │    Port 5432        │        │      Port 6379      │
      │                     │        │                     │
      │  candidates table   │        │  pelgo:job_queue    │
      │  match_jobs table   │        │  (signal only)      │
      └──────────┬──────────┘        └──────────┬──────────┘
                 │                              │
      ┌──────────▼──────────────────────────────▼──────────┐
      │            WORKER CONTAINERS (2+)                   │
      │            (Out-of-process background processors)   │
      │                                                     │
      │  1. Poll PostgreSQL: SELECT ... FOR UPDATE          │
      │     SKIP LOCKED (race-safe)                         │
      │  2. Load candidate profile                          │
      │  3. Run LangGraph agent pipeline                    │
      │  4. Save result + agent_trace to match_jobs         │
      │  5. On failure: retry up to 3x, then dead-letter    │
      └─────────────────────┬───────────────────────────────┘
                            │
      ┌─────────────────────▼───────────────────────────────┐
      │           LANGGRAPH AGENT PIPELINE                   │
      │                                                      │
      │   ┌──────────────────────┐                           │
      │   │   agent_reason()     │ ← Entry point             │
      │   │   (LLM decides next) │                           │
      │   └──────────┬───────────┘                           │
      │              │                                       │
      │   ┌──────────▼───────────┐                           │
      │   │  Tool 1: extract_jd  │ Parse JD → requirements   │
      │   └──────────┬───────────┘                           │
      │              │                                       │
      │   ┌──────────▼───────────┐                           │
      │   │  Tool 2: score       │ Multi-dim scoring         │
      │   │  candidate           │ + confidence check        │
      │   └──────────┬───────────┘                           │
      │              │                                       │
      │         confidence == LOW?                           │
      │         YES → inject diagnostic → re-reason          │
      │         NO  ↓                                        │
      │   ┌──────────▼───────────┐                           │
      │   │  Tool 3: prioritise  │ Rank gaps by impact       │
      │   │  gaps                │                           │
      │   └──────────┬───────────┘                           │
      │              │                                       │
      │   ┌──────────▼───────────┐                           │
      │   │  Tool 4: research    │ DuckDuckGo + GitHub API   │
      │   │  skills (top 3 only) │ (real external calls)     │
      │   └──────────┬───────────┘                           │
      │              │                                       │
      │   ┌──────────▼───────────┐                           │
      │   │  compile_output()    │ → Validated MatchResult   │
      │   └──────────────────────┘                           │
      └──────────────────────────────────────────────────────┘
```

---

## 5. Agent Architecture (graph.py — Core Logic)

### 5.1 State Machine (TypedDict)

The agent uses a **typed state** (`AgentState` in `app/models/agent_state.py`) — not a global variable. LangGraph manages it across tool calls within a single run.

```python
class AgentState(TypedDict, total=False):
    # Inputs
    job_id: str
    candidate_profile: dict
    job_description_text: str
    job_url: Optional[str]

    # Tool outputs (populated as agent runs)
    requirements: Optional[dict]          # from extract_jd
    scoring_result: Optional[dict]        # from score_candidate
    prioritised_gaps: Optional[list]      # from prioritise_gaps
    skill_resources: dict[str, Any]       # skill_name → resources

    # Agent reasoning
    messages: list[Any]                   # LangGraph message history
    current_step: str                     # init → extracted → scored → prioritised → researched → completed
    should_gather_more_signal: bool       # flag for low confidence handling
    retry_counts: dict[str, int]          # tool_name → retry count

    # Trace (populated by orchestrator, NOT by LLM)
    agent_trace: dict                     # tool_calls[], total_llm_calls, fallbacks_triggered
    total_llm_calls: int
    fallbacks_triggered: int

    # Progress callback (saves incremental trace to DB)
    progress_callback: Optional[Callable]

    # Final output
    final_output: Optional[dict]
    error: Optional[str]
```

### 5.2 Graph Nodes

```
agent_reason → [should_continue] → execute_tools → [after_tools] → agent_reason (loop)
                                                                  → compile_output → END
```

**Three nodes:**
1. **`agent_reason()`** — LLM decides which tool to call next. On first call (step="init"), directly invokes all 4 tools sequentially to bypass Gemini 2.5's unreliable `bind_tools` behavior.
2. **`execute_tools()`** — Executes tool calls with timeout protection, validates outputs, records real trace.
3. **`compile_output()`** — Assembles final `MatchResult` from accumulated state.

**Two routing functions:**
- **`should_continue()`** — After `agent_reason`: if last message has tool_calls → `execute_tools`, else → `compile_output`
- **`after_tools()`** — After `execute_tools`: checks safety limits (MAX_TOOL_CALLS=10, MAX_LLM_CALLS=8), handles low confidence injection, decides whether to reason more or compile

### 5.3 System Prompt

```
You are Pelgo's Career Intelligence Agent. Your ONLY job is to analyze how well
a candidate matches a job description and create an actionable learning plan.

MANDATORY WORKFLOW:
1. Call extract_jd_requirements with the job description text
2. Call score_candidate_against_requirements with candidate + requirements
3. If confidence is LOW, consider re-extracting with more detail
4. Call prioritise_skill_gaps with gap skills
5. Call research_skill_resources ONLY for the top 3 priority gaps
6. Compile the final match result

RULES:
- Always start with extract_jd_requirements
- After scoring, check confidence. If LOW, try to gather more signal
- Only research the top 3 priority skills, not all gaps
- If a tool fails, decide whether to retry, skip, or use partial data
- Stop after you have enough information to produce a final answer
```

### 5.4 Direct Tool Invocation Optimization

On the first step (`current_step == "init"`), the agent **bypasses LLM reasoning** and directly calls all 4 tools sequentially:

1. `extract_jd_requirements` → parse JD
2. `score_candidate_against_requirements` → score candidate
3. `prioritise_skill_gaps` → rank gaps
4. `research_skill_resources` → research top 3 gaps

**Why:** Gemini 2.5 is unreliable with `bind_tools` — sometimes it doesn't call the right tools or calls them with wrong arguments. Direct invocation guarantees the pipeline runs correctly on the first pass. After all tools complete, the LLM does one final reasoning call to compile the output.

If direct invocation fails for any reason, it falls through to normal LLM reasoning (the standard LangGraph loop).

---

## 6. The 4 Tools (Detailed)

### Tool 1: `extract_jd_requirements(job_url_or_text)` — `app/tools/extract_jd.py`

**Purpose:** Parse a job description into structured requirements.

**Input:** Raw JD text or a URL (auto-detected by `http://` or `https://` prefix).

**Output:**
```json
{
  "required_skills": ["Python", "React", "SQL", ...],
  "nice_to_have_skills": ["Kubernetes", "GraphQL", ...],
  "seniority_level": "senior",
  "domain": "fintech",
  "responsibilities": ["Lead backend team", ...],
  "company_name": "Acme Corp",
  "job_title": "Senior Software Engineer"
}
```

**Key behaviors:**
- If URL: fetch with httpx, parse with BeautifulSoup (lxml), strip scripts/styles/nav/footer
- SSRF protection: blocks private IPs, loopback, `metadata.google.internal`, link-local
- Caching: SHA256[:16] content hash → in-memory dict (lost on restart)
- Skill normalization: extracts canonical skill names ("Excel" not "Excel modeling")
- Pydantic validation: output validated against `JobRequirements` schema

### Tool 2: `score_candidate_against_requirements(candidate_profile, requirements)` — `app/tools/score_candidate.py`

**Purpose:** Multi-dimensional scoring with confidence assessment.

**Input:** Candidate profile dict + extracted requirements dict.

**Output:**
```json
{
  "overall_score": 72,
  "dimension_scores": {"skills": 65, "experience": 80, "seniority_fit": 75},
  "matched_skills": ["Python", "FastAPI", "PostgreSQL"],
  "gap_skills": ["Kubernetes", "GraphQL"],
  "confidence": "high"
}
```

**Key behaviors:**
- Weighted scoring: skills 50%, experience 30%, seniority_fit 20%
- Fuzzy skill matching: "React" = "React.js", "Python" covers "Python scripting", "SQL" covers "MySQL"/"PostgreSQL"
- A skill NEVER appears in both matched and gap lists
- DimensionScores clamped to 0-100, floats rounded to int

**Confidence heuristic (rule-based, not LLM-asserted):**

| Confidence | Condition |
|------------|-----------|
| **HIGH** | >=70% required skills matched AND JD has >=5 required skills AND domain overlap |
| **MEDIUM** | 40-70% matched OR 3-4 required skills |
| **LOW** | <40% matched OR <3 required skills OR very different domain |

### Tool 3: `research_skill_resources(skill_name, seniority_context)` — `app/tools/research_skills.py`

**Purpose:** Find real learning resources for a skill gap.

**Input:** Skill name + seniority level string.

**Output:**
```json
{
  "resources": [
    {"title": "Kubernetes for Developers - Udemy", "url": "https://...", "estimated_hours": 20, "type": "course"},
    {"title": "awesome-kubernetes", "url": "https://github.com/...", "estimated_hours": 10, "type": "doc"}
  ],
  "relevance_score": 0.85
}
```

**Key behaviors:**
- **Real external API calls** (assignment requirement):
  1. DuckDuckGo HTML search (free, no API key): `https://html.duckduckgo.com/html/`
  2. GitHub search API (free, no key): `https://api.github.com/search/repositories`
- If external search returns results → LLM synthesizes with search data
- If external search fails → LLM generates from its own knowledge (fallback)
- Caching: by `"{skill}:{seniority}"` key → in-memory dict
- Returns 4-5 resources: mix of courses, docs, projects, certifications
- Validated against `SkillResourceResult` Pydantic model

### Tool 4: `prioritise_skill_gaps(gap_skills, job_market_context)` — `app/tools/prioritise_gaps.py`

**Purpose:** Rank skill gaps by impact (NOT alphabetically).

**Input:** List of gap skill names + job market context string (e.g., "fintech industry, senior level role").

**Output:**
```json
[
  {"skill": "Kubernetes", "priority_rank": 1, "estimated_match_gain_pct": 12, "rationale": "Essential for the cloud-native stack"},
  {"skill": "GraphQL", "priority_rank": 2, "estimated_match_gain_pct": 8, "rationale": "API layer modernization"}
]
```

**Key behaviors:**
- Ranking considers: match score improvement, market demand, learning effort, prerequisite relationships
- Ranks enforced sequential (1, 2, 3...) after sorting
- Each entry validated against `PrioritisedSkill` Pydantic model
- Only top 3 gaps get researched (Tool 3) — prevents unbounded tool calls

---

## 7. Failure Handling (3 Modes) — `app/agent/failure_handlers.py`

### Mode 1: Tool Timeout

**Trigger:** Any tool call exceeds `TOOL_TIMEOUT_SECONDS` (default: 30s).

**Mechanism:** `with_timeout()` uses `concurrent.futures.ThreadPoolExecutor` with deadline.

**Strategy:**
1. First timeout → retry once
2. Second timeout → skip tool, proceed with partial data
3. Record in agent_trace: `{"tool": "...", "status": "timeout"}`

**Why:** Better to return a partial learning plan than crash the entire run.

### Mode 2: Invalid Tool Output

**Trigger:** `extract_jd_requirements` or `score_candidate` returns JSON that fails Pydantic validation.

**Mechanism:** `validate_or_retry_extraction()` / `validate_or_retry_scoring()`

**Strategy:**
1. Try full Pydantic validation
2. If fails → attempt partial recovery (extract valid fields, fill defaults for missing)
3. If still fails → return None, agent proceeds with what it has
4. Schema validation ALWAYS happens before persisting to DB — malformed data never reaches PostgreSQL

### Mode 3: Low Confidence Score

**Trigger:** `score_candidate` returns `confidence: "low"`.

**Mechanism:** `handle_low_confidence()` diagnoses the cause and injects guidance.

**Strategy:**
1. Diagnose cause: sparse JD (<3 required skills)? Low match ratio (<40%)? Zero skill overlap?
2. Generate diagnostic guidance string
3. Inject as `HumanMessage` into agent's message history
4. Agent re-reasons with context (may re-extract JD or re-score with enriched context)
5. `should_gather_more_signal` flag set to False after injection (only inject once)
6. If still low after re-reasoning → accept with explicit reasoning in output

---

## 8. Worker Architecture — `app/worker/main.py`

### Job Claiming (Race-Safe)

```sql
SELECT id FROM match_jobs
WHERE status = 'pending'
ORDER BY created_at ASC
LIMIT 1
FOR UPDATE SKIP LOCKED
```

- `FOR UPDATE` locks the row
- `SKIP LOCKED` makes other workers skip locked rows (no duplicate processing)
- After SELECT, immediately UPDATE status to `'processing'`
- Transaction committed → row released from lock

### Worker Loop

```python
while running:
    1. Check Redis for signal (rpop "pelgo:job_queue") — non-blocking
    2. Claim job from PostgreSQL (race-safe)
    3. If job found: process_job(job, session)
    4. If no job: sleep(POLL_INTERVAL=2 seconds)
```

### Job Processing

```python
def process_job(job, session):
    1. Load candidate profile from candidates table
    2. Build candidate_profile dict
    3. Create progress_callback (saves incremental trace to DB)
    4. Run agent: run_agent(job_id, candidate_profile, jd_text, job_url, progress_callback)
    5. Validate result with MatchResult Pydantic model
    6. Update match_jobs: status="completed", result=JSONB, agent_trace=JSONB
    7. On exception:
       - Increment retry_count
       - If retry_count >= 3: status="failed" (dead letter)
       - If retry_count < 3: status="pending" (retry)
```

### Scaling

```bash
docker-compose up --scale worker-1=5 --scale worker-2=5
# No code changes needed — PostgreSQL FOR UPDATE SKIP LOCKED handles concurrency
```

### Graceful Shutdown

Worker handles SIGTERM and SIGINT — sets `running = False`, finishes current job, then exits.

---

## 9. Database Schema — `app/db/tables.py`

### Table: `candidates`

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID (PK) | Auto-generated |
| `name` | String(255) | Candidate full name |
| `email` | String(255) | Email address |
| `summary` | Text | AI-generated professional summary |
| `skills` | JSONB | `["Python", "React", "SQL", ...]` |
| `experiences` | JSONB | `[{title, company, duration_years, description, skills_used}, ...]` |
| `education` | JSONB | `[{degree, institution, field_of_study, year}, ...]` |
| `seniority_level` | String(50) | intern/junior/mid/senior/staff/lead/principal/director |
| `total_years_experience` | Float | Total years of professional experience |
| `created_at` | DateTime | UTC timestamp |

### Table: `match_jobs`

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID (PK) | Auto-generated |
| `candidate_id` | UUID (FK) | References `candidates.id` |
| `job_description_text` | Text | Raw JD text (up to 10k chars) |
| `job_url` | String(2048) | Optional URL source |
| `status` | String(20) | `pending` → `processing` → `completed` / `failed` |
| `result` | JSONB | Full `MatchResult` (score, gaps, learning_plan, etc.) |
| `agent_trace` | JSONB | Tool calls, latencies, LLM call count, fallbacks |
| `error_detail` | Text | Error message on failure |
| `retry_count` | Integer | 0-3, incremented on failure |
| `created_at` | DateTime | UTC timestamp |
| `updated_at` | DateTime | UTC timestamp, auto-updated |

**Indexes:**
- `ix_match_jobs_candidate_id` — filter all jobs for a candidate
- `ix_match_jobs_status` — worker polling for pending jobs

---

## 10. API Endpoints (15 Total) — `app/api/main.py`

### Core Endpoints (Assignment Required)

| Method | Endpoint | Purpose |
|--------|----------|---------|
| `POST` | `/api/v1/candidate` | Upload resume (PDF via file upload or text via form). Gemini parses → structured profile → PostgreSQL |
| `PUT` | `/api/v1/candidate/{id}` | Re-parse updated resume text |
| `POST` | `/api/v1/matches` | Submit up to 10 JDs. Creates `match_jobs` with `status: pending`. Signals Redis. Returns job IDs immediately |
| `GET` | `/api/v1/matches/{id}` | Get status + full result + agent_trace for one job |
| `GET` | `/api/v1/matches` | Paginated list. Query params: `status`, `candidate_id`, `limit`, `offset` |
| `DELETE` | `/api/v1/matches/{id}` | Delete a match job |
| `POST` | `/api/v1/matches/{id}/requeue` | Admin: re-queue a failed job (resets retry_count, sets status=pending) |

### Bonus Endpoints (Beyond Assignment)

| Method | Endpoint | Purpose |
|--------|----------|---------|
| `POST` | `/api/v1/cv/improve` | AI text revision: improve/shorten/expand/quantify selected text |
| `POST` | `/api/v1/cv/generate-markdown` | Generate polished Markdown CV from candidate profile |
| `POST` | `/api/v1/cover-letter` | Generate tailored cover letter (candidate + job match context) |
| `POST` | `/api/v1/company-profile` | Extract company insights from JD text |
| `POST` | `/api/v1/assessment/generate` | Generate 5-question skill quiz (multiple choice) |
| `POST` | `/api/v1/assessment/grade` | Grade quiz answers with AI feedback |
| `POST` | `/api/v1/adk/extract-jd` | JD extraction via Google ADK (stretch goal) |
| `GET` | `/health` | Health check → `{"status": "ok"}` |

---

## 11. Final Agent Output Schema (A3)

Every completed job produces a `MatchResult` validated by Pydantic before persisting:

```json
{
  "job_id": "uuid",
  "overall_score": 72,
  "confidence": "high",
  "dimension_scores": {
    "skills": 65,
    "experience": 80,
    "seniority_fit": 75
  },
  "matched_skills": ["Python", "FastAPI", "PostgreSQL"],
  "gap_skills": ["Kubernetes", "GraphQL"],
  "reasoning": "Candidate matches 3 of 5 required skills with overall score 72/100 (high confidence). Key gaps: Kubernetes, GraphQL. Domain: fintech.",
  "learning_plan": [
    {
      "skill": "Kubernetes",
      "priority_rank": 1,
      "estimated_match_gain_pct": 12,
      "resources": [
        {"title": "Kubernetes for Developers - Udemy", "url": "https://...", "estimated_hours": 20, "type": "course"}
      ],
      "rationale": "Essential for cloud-native deployment in fintech"
    }
  ],
  "agent_trace": {
    "tool_calls": [
      {"tool": "extract_jd_requirements", "status": "success", "latency_ms": 340},
      {"tool": "score_candidate_against_requirements", "status": "success", "latency_ms": 1200},
      {"tool": "prioritise_skill_gaps", "status": "success", "latency_ms": 800},
      {"tool": "research_skill_resources", "status": "success", "latency_ms": 2500}
    ],
    "total_llm_calls": 5,
    "fallbacks_triggered": 0,
    "total_tokens_used": 3200
  }
}
```

**Critical:** `agent_trace` is populated by the orchestration layer (graph.py), NOT fabricated by the LLM. Each tool call records real latency via `time.time()`.

---

## 12. LLM Integration — `app/llm.py`

### Gemini Configuration

```python
model = "gemini-2.5-flash-lite"   # Fast, cost-effective, reliable JSON output
temperature = 0                    # Deterministic
max_output_tokens = varies         # 1500-8192 depending on tool
```

### Authentication

```python
# Service account credentials from GCP
credentials = service_account.Credentials.from_service_account_file(
    "gemini_creds.json",
    scopes=["https://www.googleapis.com/auth/cloud-platform"],
)
vertexai.init(project=..., location="us-central1", credentials=credentials)
```

### Token Tracking

Every `call_gemini()` call logs token usage via structlog:
```
llm_token_usage prompt_tokens=450 completion_tokens=320 total_tokens=770 model=gemini-2.5-flash-lite
```

### LLM for Agent (LangChain Integration)

```python
# In graph.py — uses LangChain's ChatVertexAI for tool binding
llm = ChatVertexAI(
    model="gemini-2.5-flash-lite",
    project=..., location=...,
    max_output_tokens=4096,
    temperature=0,
).bind_tools(ALL_TOOLS)
```

---

## 13. Frontend Architecture

### Pages (9 total)

| Page | Route | Purpose |
|------|-------|---------|
| OnboardingPage | `/onboarding` | Resume upload (PDF or text paste) |
| DashboardPage | `/` | All matches with scores, statuses, progress bars |
| JobAnalysisPage | `/matches/:jobId` | Dimension scores, skill breakdown, radar chart |
| LearningPathPage | `/matches/:jobId/learn` | Prioritised gaps + curated resources |
| AgentTracePage | `/matches/:jobId/trace` | Step-by-step tool call visualization |
| CvEditorPage | `/cv-editor` | Markdown CV editor with AI revision buttons |
| ComparePage | `/compare` | Side-by-side comparison of multiple jobs |
| AssessmentPage | `/assessment` | Skill quizzes, auto-grading |
| UploadPage | `/upload` | Alternate resume upload flow |

### State Management

- **CandidateContext**: Global candidate profile + matches list, stored in `localStorage("pelgo_candidate")`, auto-refreshes
- **ThemeContext**: Dark/light mode toggle
- **Polling**: Frontend polls `GET /api/v1/matches` every 3 seconds while any job is `pending` or `processing`

### Design System (Pelgo Meridian)

13 shared components: ScoreGauge, RadarChart, DimensionBar, GrowthBar, SkillChip, PriorityBadge, InsightCard, ResourceCard, StatCard, ExportReport, Breadcrumb, Icon, etc.

---

## 14. Docker Setup

### docker-compose.yml — 5 Services

```yaml
postgres:     # PostgreSQL 16 Alpine, port 5432, healthcheck: pg_isready
redis:        # Redis 7 Alpine, port 6379, healthcheck: redis-cli ping
api:          # FastAPI (alembic upgrade → seed → uvicorn --reload), port 8000
              # Depends on: postgres (healthy), redis (healthy)
              # Mounts: ./gemini_creds.json:/app/gemini_creds.json:ro
worker-1:     # python -m app.worker.main, depends on api (healthy)
worker-2:     # python -m app.worker.main, depends on api (healthy)
frontend:     # Nginx + React SPA, port 3000, depends on api (healthy)
```

### Startup Sequence

```
1. PostgreSQL starts → healthcheck passes (pg_isready)
2. Redis starts → healthcheck passes (redis-cli ping)
3. API starts → runs alembic upgrade head → runs seed.py → starts uvicorn
4. API healthcheck passes (curl http://localhost:8000/health)
5. Workers start → poll for jobs
6. Frontend starts → Nginx serves React SPA
```

### Running

```bash
# Start everything
docker-compose up --build

# Start in background
docker-compose up -d --build

# Scale workers
docker-compose up --scale worker-1=5 --scale worker-2=5
```

---

## 15. Monitoring & Logging

### Log Commands

```bash
# All containers (real-time, follow)
docker-compose logs -f

# Specific container
docker-compose logs -f api
docker-compose logs -f worker-1
docker-compose logs -f worker-2

# Last N lines
docker-compose logs --tail=100 worker-1

# Filter by keyword
docker-compose logs -f worker-1 | grep "job_completed"
docker-compose logs -f worker-1 | grep "tool_timeout"
docker-compose logs -f api | grep "candidate_created"
```

### Key Log Events

```
# Worker lifecycle
worker_started          worker=worker-12345 pid=1
worker_redis_connected  worker=worker-12345
worker_shutdown_signal  worker=worker-12345

# Job processing
processing_job          job_id=abc-123 worker=worker-12345 retry=0
job_completed           job_id=abc-123 score=78 confidence=high
job_failed              job_id=abc-123 error="..." retry=1
job_dead_letter         job_id=abc-123 retries=3

# Tool execution
agent_direct_extract_success  latency_ms=340 num_skills=8
agent_direct_score_success    latency_ms=1200 score=72 confidence=high
agent_direct_prioritise_success  latency_ms=800 num_gaps=5
agent_direct_research_success    skill=Kubernetes latency_ms=2500

# Failure handling
tool_timeout_triggered  tool=research_skill_resources
extraction_validation_failed  error="..."
low_confidence_handler  reasons=2 match_ratio=0.3
tool_retry_scheduled    tool=extract_jd attempt=1

# Caching
extract_jd_cache_hit    cache_key=a1b2c3d4
research_skills_cache_hit  skill=Python

# Token usage
llm_token_usage  prompt_tokens=450 completion_tokens=320 total_tokens=770 model=gemini-2.5-flash-lite

# API events
candidate_created  id=abc-123 name="John Doe"
matches_created    candidate_id=abc-123 num_jobs=3
job_deleted        job_id=abc-123
job_requeued       job_id=abc-123
```

---

## 16. Environment Variables

```bash
# Required — Google Cloud / Vertex AI
GOOGLE_CLOUD_PROJECT=your-gcp-project-id
GOOGLE_CLOUD_LOCATION=us-central1
GOOGLE_APPLICATION_CREDENTIALS=/app/gemini_creds.json
GEMINI_MODEL=gemini-2.5-flash-lite

# Database (defaults work with docker-compose)
DATABASE_URL=postgresql+asyncpg://pelgo:pelgo@postgres:5432/pelgo
DATABASE_URL_SYNC=postgresql://pelgo:pelgo@postgres:5432/pelgo

# Redis
REDIS_URL=redis://redis:6379/0

# App tuning
LOG_LEVEL=INFO
WORKER_CONCURRENCY=2
TOOL_TIMEOUT_SECONDS=30
MAX_RETRIES=3
```

**Credential file:** Download service account JSON from GCP Console → save as `gemini_creds.json` in project root. Docker mounts it read-only into `/app/gemini_creds.json`.

---

## 17. Key Architectural Decisions & Trade-offs

| Decision | Chosen | Alternative | Why |
|----------|--------|-------------|-----|
| Agent framework | LangGraph | CrewAI, AutoGen, custom ReAct | Typed state (TypedDict), conditional routing, native tool execution. CrewAI too opinionated, AutoGen too chat-oriented |
| LLM model | Gemini 2.5 Flash Lite | GPT-4o, Claude, Gemini Pro | Fast (~1-3s/call), cheap, reliable JSON. Assignment doesn't require specific model |
| First-step optimization | Direct tool invocation | Let LLM reason first | Gemini 2.5 unreliable with `bind_tools` on first reasoning step. Direct call guarantees pipeline runs |
| Job queue | PostgreSQL + Redis signal | Celery, RabbitMQ, SQS | Simpler. PostgreSQL as queue (FOR UPDATE SKIP LOCKED) + Redis for wake-up signal. No extra infrastructure |
| Job state | PostgreSQL only | Redis | Single source of truth. If Redis dies, workers still poll PostgreSQL |
| Cache | In-memory dict | Redis, Memcached | Simple for MVP. Lost on restart — acceptable trade-off for assignment scope |
| Worker model | Out-of-process containers | Threads inside API, Celery workers | Assignment requires out-of-process. Clean failure isolation, independent scaling |
| Research scope | Top 3 gaps only | All gaps | Prevents unbounded tool calls. Focus on highest-impact skills |
| Confidence | Rule-based heuristic | LLM self-assessment | Reproducible, transparent. Not arbitrary — based on match ratio, skill count, domain overlap |
| Frontend polling | 3s interval | WebSocket, SSE | Simpler to implement. WebSocket would be better for production but adds complexity |

---

## 18. Testing

### Unit Tests (`tests/test_tools.py` — 31 tests)

Tests with mocked LLM (no external dependencies):
- Schema validation (A3 output, dimension clamping 0-100, float→int coercion)
- Failure handlers (timeout via ThreadPoolExecutor, partial recovery, low confidence guidance)
- SSRF URL validation (blocks private IPs, loopback, metadata endpoints)
- LLM response parsing (strip markdown fences, handle truncated JSON)
- All 4 tools with mocked Gemini responses

### Integration Tests (`tests/test_integration.py` — 5 tests)

Requires running Docker stack:
- Full lifecycle: ingest candidate → submit JD → agent runs → result with valid agent_trace
- Pagination (limit/offset)
- 404 handling
- Verifies agent_trace is real (tool_calls array populated, latencies > 0)

### Running Tests

```bash
# Unit tests (no Docker needed)
pytest tests/test_tools.py -v

# Integration tests (Docker stack must be running)
docker-compose up -d
pytest tests/test_integration.py -v
```

---

## 19. Google ADK Stretch Goal — `app/tools/adk_extract_jd.py`

Implemented `extract_jd_requirements` as a Google ADK tool alongside the LangGraph version.

**How it works:**
- In `execute_tools()` (graph.py), when tool is `extract_jd_requirements`:
  1. Try ADK version first (`run_adk_extraction()`)
  2. If ADK succeeds → use its result
  3. If ADK fails → fallback to LangGraph tool

**Standalone endpoint:** `POST /api/v1/adk/extract-jd` — extracts JD via ADK, falls back to standard tool on error.

**What ADK provides that LangGraph doesn't:**
- Native Google ecosystem integration
- Session management for multi-turn conversations
- Event streaming for real-time progress
- Simpler setup for Google-native tools

---

## 20. Security Measures

- **SSRF Protection** (`utils.py:validate_url`): Blocks private IPs, loopback, link-local, `metadata.google.internal`, non-HTTP(S) schemes
- **File Size Limit**: Resume upload max 10 MB
- **Input Validation**: All API inputs validated via Pydantic models
- **JD Text Cap**: 10k chars max stored in DB
- **No SQL Injection**: SQLAlchemy ORM + parameterized queries
- **CORS**: Configured (currently `allow_origins=["*"]` for development)
- **Credentials**: gemini_creds.json mounted read-only, never exposed to frontend
- **Schema Validation**: All agent outputs validated before DB persistence — malformed data never reaches PostgreSQL

---

## 21. Data Flow Summary

```
[User uploads resume]
        │
        ▼
POST /api/v1/candidate → Gemini parses resume → PostgreSQL (candidates)
        │
        ▼
[User submits job descriptions]
        │
        ▼
POST /api/v1/matches → Creates match_jobs (pending) → Redis signal → Return job IDs
        │
        ▼
[Worker picks up job]
        │
        ▼
Worker: SELECT ... FOR UPDATE SKIP LOCKED → status = "processing"
        │
        ▼
LangGraph Agent Pipeline:
  1. extract_jd_requirements(JD text or URL)     → state.requirements
  2. score_candidate(candidate, requirements)     → state.scoring_result
     └─ if confidence == "low" → inject diagnostic → re-reason
  3. prioritise_skill_gaps(gap_skills, context)   → state.prioritised_gaps
  4. research_skill_resources(top 3 skills)       → state.skill_resources
  5. compile_output()                             → MatchResult (validated)
        │
        ▼
Worker: match_jobs.result = MatchResult (JSONB), status = "completed"
        │
        ▼
[Frontend polls]
        │
        ▼
GET /api/v1/matches/{id} → Display: scores, gaps, learning plan, agent trace
```
