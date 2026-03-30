# Pelgo -- AI Career Intelligence System

An agentic career-matching system that autonomously analyzes candidate profiles against job descriptions, produces multi-dimensional match scores, and generates personalized learning plans to close skill gaps. Built with a production React frontend (Pelgo Meridian design system), a FastAPI backend, LangGraph agent orchestration, and a Google ADK stretch integration.

---

## Table of Contents

- [Quick Start](#quick-start)
- [Framework Choice](#framework-choice)
- [System Architecture](#system-architecture)
- [System Prompt](#system-prompt)
- [Confidence Heuristic](#confidence-heuristic)
- [Tool Documentation](#tool-documentation)
- [Google ADK Stretch Tool](#google-adk-stretch-tool)
- [Failure Mode Decisions](#failure-mode-decisions)
- [Trade-offs](#trade-offs)
- [API Endpoints](#api-endpoints)
- [Data Model](#data-model)
- [Worker Architecture](#worker-architecture)
- [Frontend](#frontend)
- [Testing](#testing)
- [Project Structure](#project-structure)
- [AI Tools Used](#ai-tools-used)

---

## Quick Start

### Prerequisites

1. **Docker + Docker Compose** installed ([Install Docker](https://docs.docker.com/get-docker/))
2. **Google Cloud service account** with Vertex AI API enabled:
   - Go to [GCP Console](https://console.cloud.google.com/) → create or select a project
   - Enable the **Vertex AI API** (`APIs & Services → Enable APIs → search "Vertex AI"`)
   - Go to `IAM & Admin → Service Accounts` → create a service account
   - Grant it the **"Vertex AI User"** role
   - Click the service account → `Keys → Add Key → Create new key → JSON`
   - Save the downloaded file as **`gemini_creds.json`** in the project root

### Option A: Docker Compose (recommended — runs in under 5 minutes)

```bash
# 1. Clone
git clone https://github.com/mocharil/pelgo-career-intelligence.git
cd pelgo-career-intelligence

# 2. Configure
cp .env.example .env
# Edit .env → replace "your-gcp-project-id" with your actual GCP project ID
# Example: GOOGLE_CLOUD_PROJECT=my-project-123456

# 3. Place credentials (REQUIRED)
# Copy your service account JSON key file to the project root:
cp /path/to/your-key.json ./gemini_creds.json

# 4. Start everything (one command)
docker-compose up --build

# 5. Open the UI
# Frontend:  http://localhost:3000
# API:       http://localhost:8000
# Health:    http://localhost:8000/health
```

> **Note:** First build takes 3-5 minutes (downloading dependencies). Subsequent starts are fast.
> Migrations and seed data run automatically on first boot.

`docker-compose up --build` starts the full stack: PostgreSQL, Redis, FastAPI (port 8000), 2 background workers, and the Nginx-served React frontend (port 3000). Migrations and seed data run automatically on first boot.

### Option B: Backend via Docker, Frontend via npm (for development)

```bash
# 1. Start backend services only
docker-compose up --build postgres redis api worker-1 worker-2

# 2. In a separate terminal, start the frontend dev server
cd frontend
npm install
npm run dev
# Frontend: http://localhost:3000 (proxies API to localhost:8000)
```

---

## Framework Choice

**LangGraph** -- chosen for typed state management, conditional graph routing, and built-in tool execution within a state machine.

---

## System Architecture

```
                         ┌─────────────────────────┐
                         │   React Frontend (3000)  │
                         │   Pelgo Meridian Design  │
                         └────────────┬────────────┘
                                      │ REST
                         ┌────────────▼────────────┐
                         │   FastAPI API (8000)     │
                         │   15 endpoints           │
                         └───┬──────────────┬──────┘
                             │              │ enqueue
                  ┌──────────▼──────┐  ┌────▼─────┐
                  │   PostgreSQL    │  │  Redis    │
                  │  candidates     │  │  (signal) │
                  │  match_jobs     │  └────┬──────┘
                  └─────────────────┘       │
                                  ┌─────────┴──────────┐
                                  ▼                    ▼
                            ┌──────────┐         ┌──────────┐
                            │ Worker 1 │         │ Worker 2 │
                            └─────┬────┘         └─────┬────┘
                                  │                    │
                                  ▼                    ▼
                          ┌────────────────────────────────┐
                          │       LangGraph Agent          │
                          │  ┌──────────────────────────┐  │
                          │  │ Typed State (AgentState)  │  │
                          │  └──────────────────────────┘  │
                          │  Tools:                        │
                          │  1. extract_jd_requirements    │
                          │  2. score_candidate            │
                          │  3. prioritise_skill_gaps      │
                          │  4. research_skill_resources   │
                          └────────────────────────────────┘
```

### Agent Flow

The LLM decides tool-call sequence at runtime. Typical flow:

1. `extract_jd_requirements` -- parse JD into structured requirements
2. `score_candidate_against_requirements` -- multi-dimensional scoring
3. If confidence is LOW -- agent reasons about whether to re-extract or accept
4. `prioritise_skill_gaps` -- rank gaps by impact (not alphabetically)
5. `research_skill_resources` -- find resources for top 3 gaps only (not all)
6. Compile final output

---

## System Prompt

The full prompt from `app/agent/graph.py`:

```
You are Pelgo's Career Intelligence Agent. Your job is to analyze how well a
candidate matches a job description and create an actionable learning plan.

You have access to these tools:
1. extract_jd_requirements — Parse a job description into structured requirements
2. score_candidate_against_requirements — Score a candidate against requirements
3. prioritise_skill_gaps — Rank skill gaps by impact and market demand
4. research_skill_resources — Find learning resources for specific skills

WORKFLOW:
1. First, extract requirements from the job description.
2. Score the candidate against those requirements.
3. If confidence is LOW, consider whether re-extracting with more detail would help.
4. Prioritise the skill gaps (do NOT research all gaps blindly).
5. Research resources ONLY for the top 3 priority gaps.
6. Compile the final match result.

RULES:
- Always start with extract_jd_requirements.
- After scoring, check confidence. If LOW, try to gather more signal before accepting.
- Only research the top 3 priority skills, not all gaps.
- If a tool fails, decide whether to retry, skip, or use partial data.
- Stop after you have enough information to produce a final answer.
```

Safety limits: `MAX_TOOL_CALLS = 10`, `MAX_LLM_CALLS = 8`.

---

## Confidence Heuristic

Confidence is derived from **detectable signals**, not arbitrary assertion:

| Confidence | Conditions |
|---|---|
| **HIGH** | >= 70% of required skills matched AND JD has >= 5 required skills AND candidate domain overlaps with JD domain |
| **MEDIUM** | 40-70% of skills matched OR JD has 3-4 required skills |
| **LOW** | < 40% skills matched OR JD has < 3 required skills OR candidate domain is very different from JD domain |

The scoring tool instructs the LLM to apply these rules. The confidence value is then used by the agent to decide whether to accept the score or gather more signal.

---

## Tool Documentation

### Tool 1: `extract_jd_requirements(job_url_or_text)`
- **Input:** Raw JD text or URL
- **Output:** `{required_skills[], nice_to_have_skills[], seniority_level, domain, responsibilities[]}`
- **Behavior:** If URL, fetches and parses HTML. Uses LLM to extract structured data. Schema-validated via Pydantic. Results cached by content hash.

### Tool 2: `score_candidate_against_requirements(candidate_profile, requirements)`
- **Input:** Candidate profile + extracted requirements
- **Output:** `{overall_score, dimension_scores{skills, experience, seniority_fit}, matched_skills[], gap_skills[], confidence}`
- **Behavior:** LLM-powered multi-dimensional scoring. Handles equivalent skills (React ~ React.js). Confidence computed per heuristic above.

### Tool 3: `research_skill_resources(skill_name, seniority_context)`
- **Input:** Skill name + seniority level
- **Output:** `{resources[{title, url, estimated_hours, type}], relevance_score}`
- **Behavior:** Makes **real external API call** -- SerpAPI (primary) or DuckDuckGo API (fallback). LLM structures the search results. Results cached by (skill, seniority).

### Tool 4: `prioritise_skill_gaps(gap_skills[], job_market_context)`
- **Input:** List of gap skills + market context
- **Output:** Ranked list `[{skill, priority_rank, estimated_match_gain_pct, rationale}]`
- **Behavior:** LLM-reasoned ranking by market demand, score impact, and learning effort. Not alphabetical.

### ADK Stretch: `extract_jd_requirements` (Google ADK)
- **Endpoint:** `POST /api/v1/adk/extract-jd`
- **Implementation:** `app/tools/adk_extract_jd.py`
- **Behavior:** Same extraction as Tool 1, but executed through the Google ADK runner with session management and event streaming. Falls back to LangGraph tool on failure.

---

## Google ADK Stretch Tool

`extract_jd_requirements` is also implemented as a **Google ADK tool** in `app/tools/adk_extract_jd.py`, accessible via `POST /api/v1/adk/extract-jd`.

### What ADK Gave Us That LangGraph Alone Did Not

| Feature | LangGraph | Google ADK |
|---|---|---|
| **Session Management** | Manual state passing via TypedDict | Built-in `InMemorySessionService` with automatic session lifecycle |
| **Event Streaming** | Not native -- would need custom SSE | `runner.run_async()` yields events in real-time (tool calls, responses, text) |
| **Tool Registration** | `@tool` decorator + manual binding | `FunctionTool(func=...)` with automatic schema inference from type hints |
| **Gemini Integration** | Via `langchain-google-vertexai` adapter | Native -- no adapter layer, direct model access |

ADK's event streaming is particularly valuable for the frontend -- it enables showing real-time progress of which tool is being called, without polling. In a production system, this could replace our polling-based progress with WebSocket/SSE streams.

The LangGraph version remains the primary implementation because LangGraph's conditional routing and typed state machine are better suited for the multi-step agent workflow with branching logic (e.g., low-confidence re-scoring). ADK excels at simpler, single-tool agents with real-time streaming needs.

---

## Failure Mode Decisions

### 1. Tool Timeout
**Decision:** Retry once, then skip with partial data.
**Why:** A single timeout is often transient (network blip). But waiting indefinitely blocks the pipeline. After one retry, the agent proceeds with whatever data it has -- a partial learning plan is better than no result.
**Implementation:** Tool calls run in the `execute_tools` node with retry tracking in `AgentState.retry_counts`. Max 1 retry per tool.

### 2. Invalid Tool Output
**Decision:** Attempt partial recovery, then retry with simplified extraction.
**Why:** LLM outputs are non-deterministic. A malformed response might still contain usable partial data (e.g., skills extracted but missing seniority). We try to salvage what we can before retrying.
**Implementation:** `validate_or_retry_extraction()` in `failure_handlers.py` attempts Pydantic validation, falls back to partial field extraction, and returns None only if completely unsalvageable.

### 3. Low Confidence Score
**Decision:** Agent does NOT silently return. It logs a warning, analyzes why confidence is low (JD completeness, skill overlap, domain distance), and attempts to gather more signal. If confidence remains low after one additional pass, it returns the result with explicit low-confidence reasoning.
**Why:** A silent low-confidence score is misleading. The user should know when the system is uncertain and why.
**Implementation:** The `after_tools` routing checks `should_gather_more_signal` in state. The `handle_low_confidence()` function generates diagnostic context injected into the next LLM call.

---

## Trade-offs

| Decision | Trade-off | Why |
|---|---|---|
| Gemini 2.5 Flash Lite via Vertex AI | Fast, cost-effective, good structured output | Pro account gives generous rate limits; Flash model balances speed and quality |
| In-memory cache for tools | Lost on restart, not shared between workers | Simplicity. A production system would use Redis cache, but for this scope it's sufficient |
| DuckDuckGo + GitHub API for search | Less structured results than paid APIs | Zero-cost, no API key needed. DuckDuckGo for course discovery, GitHub API for awesome-lists. Ensures real external calls. |
| Top 3 gaps only for research | May miss long-tail skills | Prevents unbounded tool calls. Top 3 by impact covers the highest-value learning |
| Sync worker with asyncio bridge | Not fully async | LangGraph's invoke is synchronous. Wrapping in asyncio.run_until_complete is pragmatic for the worker process |
| JD extraction cache by content hash | Two identical JDs submitted separately share cache | Reduces redundant LLM calls. Trade-off: if extraction logic changes, cache is stale until restart |
| React SPA + Nginx reverse proxy | Separate frontend build step | Clean separation of concerns; Nginx handles static assets and proxies API calls efficiently |
| Polling-based job status | Not real-time | Simpler than WebSockets for this scope; jobs complete in 30-60s so short polling is acceptable |

---

## API Endpoints

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/v1/candidate` | Ingest resume (PDF upload or text), extract and store structured profile |
| `PUT` | `/api/v1/candidate/{id}` | Re-parse updated resume text and update candidate profile (used by CV editor) |
| `POST` | `/api/v1/matches` | Submit up to 10 JDs for a candidate, enqueue agent runs, return job IDs |
| `GET` | `/api/v1/matches/{id}` | Get status + full result for one match job |
| `GET` | `/api/v1/matches` | Paginated list, filterable by `status` and `candidate_id` |
| `DELETE` | `/api/v1/matches/{id}` | Delete a match job |
| `POST` | `/api/v1/matches/{id}/requeue` | Admin: re-queue a failed job |
| `POST` | `/api/v1/cv/improve` | AI-powered CV text improvement (improve / shorten / expand / quantify) |
| `POST` | `/api/v1/cv/generate-markdown` | Generate a polished Markdown CV from candidate profile data |
| `POST` | `/api/v1/cover-letter` | Generate a tailored cover letter based on candidate profile and job match |
| `POST` | `/api/v1/company-profile` | Analyze a job description to extract company profile, culture signals, pros/cons |
| `POST` | `/api/v1/assessment/generate` | Generate a 5-question skill assessment quiz at a given seniority level |
| `POST` | `/api/v1/assessment/grade` | Grade quiz answers with AI-generated feedback |
| `POST` | `/api/v1/adk/extract-jd` | Extract JD requirements using Google ADK agent (stretch goal) |
| `GET` | `/health` | Health check |

---

## Data Model

### `candidates` table
| Column | Type | Notes |
|---|---|---|
| `id` | UUID | Primary key |
| `name` | String | |
| `email` | String | |
| `summary` | Text | AI-generated professional summary |
| `skills` | JSONB | List of technical skills |
| `experiences` | JSONB | List of experience objects (title, company, duration, description, skills_used) |
| `education` | JSONB | List of education objects (degree, institution, field, year) |
| `seniority_level` | String | intern / junior / mid / senior / staff / lead / principal / director |
| `total_years_experience` | Float | |
| `created_at` | Timestamp | |

### `match_jobs` table
| Column | Type | Notes |
|---|---|---|
| `id` | UUID | Primary key |
| `candidate_id` | UUID | Foreign key to candidates |
| `job_description_text` | Text | Raw JD text |
| `job_url` | String | Optional URL |
| `status` | String | pending / processing / completed / failed |
| `result` | JSONB | Full agent output (scores, gaps, learning plan) |
| `agent_trace` | JSONB | Step-by-step tool call trace |
| `error_detail` | Text | Error message on failure |
| `retry_count` | Integer | |
| `created_at` | Timestamp | |
| `updated_at` | Timestamp | |

Indexes: `candidate_id`, `status`.

---

## Worker Architecture

- **Out-of-process:** Workers run as separate Docker containers (`worker-1`, `worker-2`), not threads inside the API.
- **Race-safe:** Uses `SELECT ... FOR UPDATE SKIP LOCKED` in PostgreSQL for atomic job claiming. Multiple workers polling simultaneously will never claim the same job.
- **Failure isolation:** Each job runs in a try/except. A failed agent run stores the error and partial trace but does not crash the worker.
- **Dead letter:** After 3 failures (`retry_count >= 3`), the job moves to `status: failed` with `error_detail` preserved. Can be manually re-queued via `POST /api/v1/matches/{id}/requeue`.

### Scaling Workers

The default setup runs 2 workers. To scale horizontally:

```bash
# Scale to 10 workers (5 per service)
docker-compose up --build --scale worker-1=5 --scale worker-2=5

# Or scale to any number
docker-compose up --build --scale worker-1=N --scale worker-2=N
```

All workers share the same PostgreSQL job queue. `SELECT ... FOR UPDATE SKIP LOCKED` ensures no duplicate processing regardless of worker count. No configuration changes needed — just scale.

---

## Frontend

The frontend is a full production React SPA built with **Vite**, **TypeScript**, and **Tailwind CSS**, following the **Pelgo Meridian** design system.

### Pages

| Page | Route | Description |
|---|---|---|
| **Onboarding** | `/` | Resume upload (PDF or text) with AI-powered profile extraction |
| **Upload** | `/upload` | Alternate upload flow |
| **Dashboard** | `/dashboard` | Overview of all match jobs with status, scores, and quick actions |
| **Job Analysis** | `/job/:id` | Deep-dive into a single match: dimension scores, skill breakdown, radar chart |
| **Learning Path** | `/learning/:id` | Prioritised skill gaps with curated resources, estimated hours, growth projections |
| **Agent Trace** | `/trace/:id` | Step-by-step visualization of the agent's tool calls and reasoning |
| **CV Editor** | `/cv` | Markdown CV editor with AI revision (improve / shorten / expand / quantify) |
| **Compare** | `/compare` | Side-by-side comparison of multiple job matches |
| **Assessment** | `/assessment` | Skill quizzes: AI-generated questions, grading, and score verification |

### Features

- **Dark mode** -- system-aware theme toggle via `ThemeContext`
- **Keyboard shortcuts** -- navigation and actions via `useKeyboardShortcuts` hook
- **AI text revision** -- select CV text and choose improve / shorten / expand / quantify
- **Cover letter generator** -- tailored to each job match, using candidate profile + match analysis
- **Company profile analysis** -- extract company info, culture signals, pros/cons from JD text
- **Skill assessment + verification** -- take AI-generated quizzes, get graded with explanations
- **Score progression** -- visual tracking of match scores across jobs
- **Export report** -- download match analysis as a report
- **Radar chart** -- multi-dimensional skill visualization
- **Breadcrumb navigation** -- consistent wayfinding across all pages

### Design System: Pelgo Meridian

Shared component library in `frontend/src/components/shared/`:

| Component | Purpose |
|---|---|
| `ScoreGauge` | Animated circular score indicator |
| `RadarChart` | Multi-axis skill visualization |
| `DimensionBar` | Horizontal bar for dimension scores |
| `GrowthBar` | Progress bar for skill growth projections |
| `SkillChip` | Pill-style skill tag (matched / gap / neutral) |
| `PriorityBadge` | Priority level indicator (critical / high / medium / low) |
| `InsightCard` | Card for AI-generated insights |
| `ResourceCard` | Learning resource card with type, hours, and link |
| `StatCard` | Summary statistic card |
| `ExportReport` | Report export functionality |
| `Breadcrumb` | Navigation breadcrumbs |
| `Icon` | Consistent icon system |

### Layout

- `DashboardShell` -- main layout wrapper with side nav and top nav
- `SideNav` -- collapsible sidebar navigation
- `TopNav` -- header with search, theme toggle, and profile

### State Management

- `CandidateContext` -- global candidate profile state
- `ThemeContext` -- dark/light mode state
- `api.ts` -- typed API client for all backend endpoints

---

## Testing

### Unit Tests (no external dependencies — runs instantly)

```bash
# 31 tests: schema validation, failure handlers, SSRF protection, tool-level tests
pytest tests/test_tools.py -v
```

### Integration Tests (requires running Docker stack)

```bash
# Start the stack first
docker-compose up --build -d

# Wait for healthy, then run (from host — API on port 8000)
pytest tests/test_integration.py -v
```

### What the tests cover

| Test Suite | Tests | Coverage |
|------------|-------|----------|
| `test_tools.py` | 31 | Schema validation (A3 output, dimension clamping, float coercion), failure handlers (timeout, partial recovery, low confidence), SSRF URL validation, LLM response parsing, all 4 tools with mocked LLM |
| `test_integration.py` | 5 | Full lifecycle (candidate → JD → agent → result with agent_trace), pagination, 404 handling |

---

## Project Structure

```
pelgo/
├── app/
│   ├── agent/
│   │   ├── graph.py                # LangGraph agent orchestrator
│   │   └── failure_handlers.py     # Timeout, invalid output, low confidence
│   ├── tools/
│   │   ├── extract_jd.py           # Tool 1: JD extraction (LangGraph)
│   │   ├── adk_extract_jd.py       # Tool 1: JD extraction (Google ADK stretch)
│   │   ├── score_candidate.py      # Tool 2: Candidate scoring
│   │   ├── research_skills.py      # Tool 3: Skill resource research
│   │   └── prioritise_gaps.py      # Tool 4: Gap prioritisation
│   ├── api/
│   │   └── main.py                 # FastAPI — 15 endpoints
│   ├── worker/
│   │   └── main.py                 # Background worker (out-of-process)
│   ├── models/
│   │   ├── schemas.py              # All Pydantic models
│   │   └── agent_state.py          # Typed agent state (TypedDict)
│   ├── db/
│   │   ├── tables.py               # SQLAlchemy models (candidates, match_jobs)
│   │   ├── session.py              # Async DB session management
│   │   └── seed.py                 # Seed data script
│   ├── config.py                   # Settings (env-based)
│   ├── llm.py                      # Gemini API wrapper
│   ├── logging_config.py           # Structured logging (structlog)
│   └── utils.py                    # Helpers (Redis signaling, JSON stripping)
├── alembic/                        # Database migrations
│   ├── env.py
│   ├── script.py.mako
│   └── versions/
├── frontend/                       # React + Vite + TypeScript + Tailwind
│   ├── src/
│   │   ├── pages/
│   │   │   ├── OnboardingPage.tsx
│   │   │   ├── UploadPage.tsx
│   │   │   ├── DashboardPage.tsx
│   │   │   ├── JobAnalysisPage.tsx
│   │   │   ├── LearningPathPage.tsx
│   │   │   ├── AgentTracePage.tsx
│   │   │   ├── CvEditorPage.tsx
│   │   │   ├── ComparePage.tsx
│   │   │   └── AssessmentPage.tsx
│   │   ├── components/shared/      # Pelgo Meridian design system (12 components)
│   │   ├── layouts/                # DashboardShell, SideNav, TopNav
│   │   ├── context/                # CandidateContext, ThemeContext
│   │   ├── hooks/                  # useKeyboardShortcuts
│   │   ├── lib/                    # api.ts (typed client), skills.ts
│   │   ├── App.tsx                 # Router
│   │   └── main.tsx                # Entry point
│   ├── Dockerfile                  # Multi-stage build (Node → Nginx)
│   └── nginx.conf                  # Reverse proxy to API
├── stitch/                         # Design reference (Pelgo Meridian)
├── tests/
│   └── test_integration.py         # Full lifecycle integration test
├── docker-compose.yml              # Full stack: postgres, redis, api, 2 workers, frontend
├── Dockerfile                      # Backend container
├── requirements.txt                # Python dependencies
├── alembic.ini                     # Migration config
├── pytest.ini                      # Test config
└── README.md
```

---

## AI Tools Used

Full transparency on AI tool usage, as encouraged by the assignment:

- **Claude Code (Anthropic Opus 4.6):** Used extensively as a coding partner for implementation, debugging, code review, and test writing. Architectural decisions (LangGraph over CrewAI, typed state design, failure handler strategies, polling vs WebSocket) are my own — Claude helped execute them faster. Prompts were iterative; I directed the approach, Claude wrote the code, I reviewed and corrected.
- **Google Gemini 2.5 Flash Lite (via Vertex AI):** Powers ALL AI features at runtime:
  - Agent tools: JD extraction, candidate scoring, gap prioritisation, resource research
  - CV features: resume parsing, markdown CV generation, text improvement (improve/shorten/expand/quantify)
  - Application features: cover letter generation, company profile analysis
  - Assessment: quiz generation and grading
  - Chosen for speed (~1-3s per call), cost-effectiveness, and reliable structured JSON output.
