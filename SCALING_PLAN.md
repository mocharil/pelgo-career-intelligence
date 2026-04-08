# Pelgo — Scaling to 10K and 100K Users on GCP

**Aril Indra Permana — April 2026**

---

## Starting Point: What We Have Now (MVP on Docker Compose)

The current stack is an MVP running entirely in **Docker Compose** — not yet deployed to any cloud:

```
docker-compose.yml (5 containers, all local)
├── postgres      → PostgreSQL 16 Alpine (port 5432)
├── redis         → Redis 7 Alpine (port 6379)
├── api           → FastAPI + Uvicorn (port 8000) — runs alembic + seed + API
├── worker-1      → python -m app.worker.main (background agent processor)
├── worker-2      → python -m app.worker.main (second worker instance)
└── frontend      → Nginx + React SPA build (port 3000)
```

- **FastAPI** serves the API layer
- **LangGraph agent** with 4 tools (extract JD, score candidate, prioritise gaps, research resources)
- **PostgreSQL** as the system of record (candidates + match_jobs)
- **Redis** for job signaling only — not as a queue
- **Workers** claim jobs via `SELECT ... FOR UPDATE SKIP LOCKED` (race-safe but adds polling load on PostgreSQL)
- **Gemini 2.5 Flash Lite** via Vertex AI for all LLM calls
- **Nginx** reverse-proxies `/api/*` to backend, serves React SPA with fallback routing

This works well for development and local demo. But for production, there are two things I'd change immediately:

1. **PostgreSQL is doing double duty** — it's both the database and the job queue. At scale, the polling adds unnecessary load.
2. **Workers poll every 2 seconds** — that's wasted connections when there are no jobs, and up to 2s latency when there are.

Both problems have the same fix: move the queue to a proper message system.

---

## MVP → GCP Migration Mapping

This is how every component in the current Docker Compose maps to a GCP managed service:

### Component-by-Component Mapping

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    CURRENT MVP (Docker Compose)                             │
│                                                                             │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────┐  │
│  │ frontend │ │   api    │ │ worker-1 │ │ worker-2 │ │ postgres │ │ redis│  │
│  │ Nginx+   │ │ FastAPI  │ │ Python   │ │ Python   │ │ PG 16    │ │ 7    │  │
│  │ React    │ │ Uvicorn  │ │ process  │ │ process  │ │ Alpine   │ │Alpine│  │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘ └──────────┘ └──────┘  │
└────────┬────────────┬────────────┬────────────┬────────────┬─────────┬──────┘
         │            │            │            │            │         │
         ▼            ▼            ▼            ▼            ▼         ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                    GCP PRODUCTION (Managed Services)                        │
│                                                                             │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐              ┌──────────┐┌───────┐  │
│  │ Cloud    │ │ Cloud    │ │ Cloud    │              │ Cloud    ││Memory-│  │
│  │ Storage  │ │ Run      │ │ Run      │              │ SQL      ││store  │  │
│  │ + CDN    │ │ (API)    │ │ (Workers)│              │ Postgres ││Redis  │  │
│  └──────────┘ └──────────┘ └──────────┘              └──────────┘└───────┘  │
│                                                                             │
│  + Cloud LB          + Pub/Sub (replaces Redis signal + PG polling)         │
│  + Cloud Armor       + Secret Manager (replaces .env file)                  │
│  + Cloud Build       + Artifact Registry (Docker images)                    │
│  + Cloud Monitoring  + Vertex AI (already used, no change)                  │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Detailed Mapping Table

| MVP Component | File/Config | GCP Service | What Changes in Code |
|---------------|------------|-------------|---------------------|
| **frontend** (Nginx + React) | `frontend/Dockerfile`, `nginx.conf` | **Cloud Storage + Cloud CDN** | No code change. Build React with `npm run build`, upload `dist/` to Cloud Storage bucket. CDN serves globally. Nginx is eliminated — Cloud LB handles routing |
| **api** (FastAPI + Uvicorn) | `Dockerfile`, `app/api/main.py` | **Cloud Run (API service)** | Minimal change. Remove Nginx dependency. Cloud Run runs the same `uvicorn app.api.main:app`. Add `/health` for Cloud Run health checks (already exists) |
| **worker-1, worker-2** (Python processes) | `app/worker/main.py` | **Cloud Run (Worker service)** | **Main code change**: replace `while True: poll_postgres()` loop with HTTP endpoint that receives Pub/Sub push messages. Same `process_job()` logic inside |
| **postgres** (PostgreSQL 16) | `docker-compose.yml` | **Cloud SQL for PostgreSQL** | Change `DATABASE_URL` to Cloud SQL connection string. Add Cloud SQL Auth Proxy sidecar on Cloud Run. No schema changes |
| **redis** (Redis 7) | `docker-compose.yml` | **Memorystore for Redis** | Change `REDIS_URL` to Memorystore endpoint. Remove job signaling code (replaced by Pub/Sub). Keep Redis for caching only |
| **Job queue** (PG polling + Redis signal) | `app/worker/main.py:39-73`, `app/utils.py:79-90` | **Cloud Pub/Sub** | Replace `claim_job()` with Pub/Sub subscription. Replace `signal_workers()` with Pub/Sub publish. Biggest code change |
| **alembic migrations** | `alembic/` | **Cloud Build + Cloud SQL** | Run as Cloud Build step before deploying new API version. Same Alembic commands |
| **seed script** | `app/db/seed.py` | **Cloud Build** (one-time) | Run once during initial setup, same code |
| **.env file** | `.env`, `app/config.py` | **Secret Manager** | Change `pydantic-settings` to read from Secret Manager instead of `.env` file |
| **gemini_creds.json** | Mounted as volume | **Workload Identity Federation** | No credentials file needed. Cloud Run gets Vertex AI access via IAM service account automatically |
| **Docker images** | `Dockerfile`, `frontend/Dockerfile` | **Artifact Registry** | Push Docker images to Artifact Registry. Cloud Run pulls from there |
| **Vertex AI / Gemini** | `app/llm.py` | **Vertex AI** (same) | No change — already using Vertex AI. Just remove explicit credentials loading, use Workload Identity |

### Code Changes Required for Migration

The migration is mostly **infrastructure**, not code. Here are the actual code changes:

**1. Worker: Polling → Pub/Sub push (biggest change)**

```python
# BEFORE: app/worker/main.py — polling loop
def worker_loop():
    while running:
        job = claim_job(session)        # SELECT ... FOR UPDATE SKIP LOCKED
        if job:
            process_job(job, session)
        else:
            time.sleep(2)              # wasteful polling

# AFTER: app/worker/main.py — HTTP endpoint for Pub/Sub push
from fastapi import FastAPI, Request
app = FastAPI()

@app.post("/worker/process")
async def handle_pubsub(request: Request):
    envelope = await request.json()
    job_id = base64.b64decode(envelope["message"]["data"]).decode()
    
    session = SyncSessionLocal()
    job = session.get(MatchJobTable, job_id)
    job.status = "processing"
    session.commit()
    
    process_job(job, session)           # same agent logic, unchanged
    session.close()
    return {"status": "ok"}
```

**2. API: Signal workers via Pub/Sub instead of Redis**

```python
# BEFORE: app/utils.py
def signal_workers(job_ids):
    r = redis.Redis.from_url(settings.redis_url)
    for job_id in job_ids:
        r.lpush("pelgo:job_queue", job_id)

# AFTER: app/utils.py
from google.cloud import pubsub_v1
publisher = pubsub_v1.PublisherClient()
topic = "projects/{project}/topics/pelgo-jobs-submit"

def signal_workers(job_ids):
    for job_id in job_ids:
        publisher.publish(topic, job_id.encode())
```

**3. Config: Secret Manager instead of .env**

```python
# BEFORE: app/config.py
class Settings(BaseSettings):
    model_config = {"env_file": ".env"}

# AFTER: app/config.py (Cloud Run sets env vars from Secret Manager automatically)
class Settings(BaseSettings):
    model_config = {"extra": "ignore"}
    # Cloud Run injects env vars — no .env file needed
```

**4. LLM: Drop explicit credentials (Workload Identity handles it)**

```python
# BEFORE: app/llm.py
credentials = service_account.Credentials.from_service_account_file(
    "gemini_creds.json", ...
)
vertexai.init(project=..., credentials=credentials)

# AFTER: app/llm.py
vertexai.init(project=settings.google_cloud_project, 
              location=settings.google_cloud_location)
# Workload Identity provides credentials automatically on Cloud Run
```

### What Does NOT Change

- `app/agent/graph.py` — entire LangGraph pipeline stays the same
- `app/tools/*.py` — all 4 tools stay the same
- `app/agent/failure_handlers.py` — timeout, invalid output, low confidence handling unchanged
- `app/models/schemas.py` — all Pydantic models unchanged
- `app/db/tables.py` — database schema unchanged
- `frontend/src/**` — entire React app unchanged (just deploy build output to Cloud Storage)
- `alembic/` — migrations unchanged
- `tests/` — tests unchanged (run against Cloud SQL in CI)

**~90% of the codebase stays exactly the same.** The migration is mostly about replacing Docker Compose with GCP managed services and changing how workers receive jobs.

---

## How Workers Work Right Now (MVP)

Before talking about scaling, it's important to understand what the current worker setup actually does.

### It's 2 Separate Containers, Not Threads

```
docker-compose.yml runs 5 containers:

┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐
│ postgres│  │  redis  │  │   api   │  │worker-1 │  │worker-2 │
│ (DB)    │  │ (signal)│  │(FastAPI)│  │(Python) │  │(Python) │
│         │  │         │  │         │  │ PID 1   │  │ PID 1   │
└─────────┘  └─────────┘  └─────────┘  └────┬────┘  └────┬────┘
                                             │            │
                                        separate OS processes
                                        separate memory space
                                        separate containers
```

- `worker-1` and `worker-2` are **two independent Docker containers**, each running `python -m app.worker.main`
- They are **NOT threads** inside the API. They are **NOT a thread pool**. They are completely separate OS processes with their own memory
- The API container (`api`) only handles HTTP requests — it never runs agent jobs
- Each worker runs a simple `while True` loop: poll PostgreSQL for pending jobs → process one → repeat

### How They Don't Clash (Race Safety)

When both workers poll at the same time, PostgreSQL prevents double-processing:

```sql
-- Worker 1 and Worker 2 both run this simultaneously:
SELECT id FROM match_jobs
WHERE status = 'pending'
ORDER BY created_at ASC
LIMIT 1
FOR UPDATE SKIP LOCKED    -- this is the key line
```

- `FOR UPDATE` locks the row that worker picks
- `SKIP LOCKED` tells the other worker to skip any locked rows
- Result: Worker 1 gets Job A, Worker 2 gets Job B. Never the same job.

```
Timeline:
  Worker-1: poll → claim Job#1 (locked) → process 15s → done → poll → claim Job#3 ...
  Worker-2: poll → skip Job#1 (locked) → claim Job#2 → process 15s → done → poll ...
```

### Each Worker Processes ONE Job at a Time

This is important: each worker is **single-threaded, sequential**. It picks up one job, runs the full LangGraph agent pipeline (~15-20 seconds), saves the result, then picks the next job. No concurrency inside a single worker.

So with 2 workers, the system can process **2 jobs simultaneously**. With 5 workers, 5 jobs simultaneously.

### Scaling Workers in Docker Compose (Current MVP)

```bash
# Scale to 5 workers (instant, no code change)
docker-compose up --scale worker-1=3 --scale worker-2=2

# Or scale to 10
docker-compose up --scale worker-1=5 --scale worker-2=5
```

That's it. Each new instance is another container running the same `python -m app.worker.main`. PostgreSQL's `FOR UPDATE SKIP LOCKED` handles the coordination — no config changes needed.

## Scaling Workers on GCP

### 10K Users: Cloud Run Auto-Scaling (Simplest)

On GCP, we replace the `while True` polling loop with **event-driven Cloud Run**. Pub/Sub pushes a message to the worker when there's a new job:

```
New job created → Pub/Sub message → Cloud Run spins up worker instance → process → instance shuts down
```

Scaling is **automatic**:
- 0 jobs in queue → 0 worker instances running (cost = $0)
- 10 jobs arrive at once → Cloud Run spins up 10 instances in ~2 seconds
- Burst of 50 jobs → Cloud Run spins up 50 instances
- All jobs done → scales back to 0

```bash
# Config: set max instances via gcloud (one-time)
gcloud run services update pelgo-worker \
  --min-instances=0 \
  --max-instances=10 \
  --concurrency=1       # 1 job per instance (because agent takes 15-20s)
```

You never manually "add workers" — Cloud Run does it automatically based on Pub/Sub queue depth. The only knob is `max-instances` to control cost ceiling.

### 100K Users: Higher Limits + Worker Specialization

Same mechanism, just higher limits and split by type:

```bash
# Agent workers (heavy, 15-20s per job)
gcloud run services update pelgo-worker-agent \
  --min-instances=3 \       # always warm, avoid cold starts
  --max-instances=30 \      # handle peak bursts
  --cpu=4 --memory=4Gi \
  --concurrency=1

# Parsing workers (light, 2-3s per job)
gcloud run services update pelgo-worker-parse \
  --min-instances=0 \
  --max-instances=20 \
  --cpu=2 --memory=1Gi \
  --concurrency=4           # can handle 4 concurrent parsing jobs
```

### Comparison: How to Add Workers

| Method | How | Speed | Effort |
|--------|-----|-------|--------|
| **Docker Compose (MVP)** | `docker-compose up --scale worker-1=N` | Manual, ~10s | Run one command |
| **Cloud Run (GCP)** | Automatic — Pub/Sub triggers new instances | Automatic, ~2s | Set max-instances once |
| **GKE (if we used it)** | HPA scales pods based on queue depth | Semi-auto, ~30s | Configure HPA + metrics |

The key insight: **on Cloud Run, you don't "add workers" — you set a ceiling and let the platform handle it.** Pub/Sub queue depth → Cloud Run auto-scaler → right number of instances at any moment.

---

## Assumptions

Before the numbers, here's what I'm assuming about user behavior. These are the biggest unknowns — LLM token costs and API traffic scale directly from these.

| Metric | 10K Users | 100K Users | Reasoning |
|--------|-----------|------------|-----------|
| MAU (60% of total) | 6,000 | 60,000 | Career platforms have periodic usage — people come when job hunting |
| DAU (10% of MAU) | 600 | 6,000 | Not a daily-use app |
| JDs submitted per active user/month | 3 | 3 | Users compare a few roles per session |
| **Agent jobs/month** | **~30,000** | **~300,000** | This drives everything |
| API requests/month | ~1.5M | ~15M | Polling, page loads, CV features |
| Tokens per agent run (input) | ~4,000 | ~4,000 | System prompt + candidate + JD + 4 tool prompts |
| Tokens per agent run (output) | ~1,500 | ~1,500 | Structured JSON responses from each tool |
| Agent run time | ~15-20s | ~15-20s | 4 LLM calls + external API calls |
| Peak-to-average ratio | 3x | 3x | Monday mornings, post-layoff spikes |

---

## Architecture: 10,000 Users

At 10K, I want **low ops overhead**. The team is small (~15 people), so managed services win over self-hosted everything.

```
                      ┌─────────────────┐
                      │  Cloud LB + CDN │
                      └────────┬────────┘
                               │
                 ┌─────────────┴─────────────┐
                 │                           │
         ┌───────▼───────┐          ┌────────▼────────┐
         │  Cloud Run    │          │  Cloud Storage  │
         │  API          │          │  Frontend SPA   │
         │  min:1 max:5  │          │  + CDN          │
         │  2vCPU / 2GB  │          └─────────────────┘
         └───────┬───────┘
                 │
     ┌───────────┼───────────────┐
     │           │               │
┌────▼────┐ ┌───▼────┐  ┌───────▼────────┐
│Cloud SQL│ │Pub/Sub │  │ Cloud Run      │
│Postgres │ │(queue) │  │ Workers        │
│         │ │        │──│ event-driven   │
│db-2vCPU │ │        │  │ min:0 max:10   │
│7.5GB HA │ │        │  │ 2vCPU / 2GB    │
└─────────┘ └────────┘  └───────┬────────┘
                                │
                         ┌──────▼──────┐
                         │  LLM Layer  │
                         │  (fallback) │
                         │             │
                         │  Gemini ──primary
                         │  OpenAI ──fallback
                         └─────────────┘
```

### What Changed from Current Design

| Current (Docker Compose) | Production 10K (GCP) | Why |
|--------------------------|---------------------|-----|
| PostgreSQL polling + Redis signal | **Pub/Sub** | Removes polling load from PostgreSQL. Zero cost at this volume. Workers get triggered instantly instead of 2s delay |
| Always-running worker containers | **Cloud Run event-driven workers** | Scale to zero when no jobs. Scale up automatically during peaks. Pay only for actual compute |
| Nginx serving frontend | **Cloud Storage + CDN** | Cheaper, faster, zero maintenance. Global edge caching |
| Docker Compose | **Cloud Run services** | Auto-scaling, health checks, zero-downtime deploys |
| No HA | **Cloud SQL HA** | Worth it even at 10K — an unplanned DB outage kills user trust. The ~$100 extra is insurance |

### Why Pub/Sub Instead of Keep Polling?

The current `SELECT ... FOR UPDATE SKIP LOCKED` pattern works, but it has issues at scale:
- Each worker opens a connection and polls every 2 seconds — that's wasted DB connections
- If you have 10 workers, that's 5 queries/second just for polling empty queues
- No built-in retry, dead-letter, or backpressure

Pub/Sub solves all of these for essentially $0 at 10K volume (free tier covers 10 GiB/month). Workers become event-driven — they wake up only when there's a job.

The code change is small:
```python
# Before (worker/main.py):
while running:
    job = claim_job(session)  # polls PostgreSQL every 2s

# After:
@app.post("/worker/process")  # Cloud Run receives Pub/Sub push
async def process_job(request: Request):
    message = parse_pubsub_message(request)
    job_id = message["job_id"]
    # ... same agent logic ...
```

PostgreSQL still stores the job data and results. Pub/Sub just handles the "hey, there's work to do" notification.

### LLM Failover (applies to both 10K and 100K)

The MVP has a single point of failure: Gemini. If Vertex AI has an outage, all agent jobs fail. Even at 10K users, that's unacceptable for a production service.

I've implemented a multi-provider abstraction layer in `app/llm.py`:

```
call_llm() → Gemini (primary) → if fails → OpenAI gpt-4o-mini (fallback) → if all fail → raise
```

This is opt-in: set `OPENAI_API_KEY` in env and the fallback activates automatically. Without it, behavior is identical to before. The cost of having OpenAI as backup is $0 when Gemini is healthy — we only pay when it actually gets used.

I also added model routing by task complexity — simple tasks (JD extraction, gap ranking) use the cheapest model, while complex tasks (candidate scoring, re-scoring) can be routed to a stronger model. This is a config change, not a code change. More detail in the 100K section below.

### Cost Estimate: 10K Users

| Service | Spec | Monthly Cost |
|---------|------|-------------|
| **Cloud Run — API** | 2vCPU/2GB, min 1 always-on + burst | $130 |
| **Cloud Run — Workers** | 2vCPU/2GB, event-driven, min 0 | $60 |
| **Cloud SQL PostgreSQL** | db-custom-2-7680, HA enabled, 20GB SSD | $200 |
| **Memorystore Redis** | Basic 1GB (for caching JD extractions) | $20 |
| **Vertex AI (Gemini)** | 30K runs × ~5.5K tokens/run | $70 |
| **Pub/Sub** | ~30K messages/mo | ~$0 (free tier) |
| **Cloud LB** | 1 forwarding rule | $18 |
| **Cloud CDN + Storage** | Frontend assets | $10 |
| **Logging & Monitoring** | ~10GB/mo (free tier) | $0 |
| | | |
| **Total** | | **~$508/mo** |

**LLM cost breakdown:**
- Input: 30K runs × 4,000 tokens = 120M tokens × $0.10/1M = $12
- Output: 30K runs × 1,500 tokens = 45M tokens × $0.40/1M = $18
- Other LLM calls (resume parsing, CV improve, etc.): ~$40
- **Total LLM: ~$70/mo** — this is only 14% of total cost. Compute and DB dominate.

---

## Architecture: 100,000 Users

At 100K, three things change:
1. **The job queue needs to be rock-solid** — 300K agent runs/month means ~400/hour sustained, 1,200/hour at peak
2. **The database can't do everything** — separate read traffic from write traffic
3. **LLM cost becomes significant** — need to optimize token spend

```
                      ┌──────────────────────┐
                      │  Global LB + CDN     │
                      │  + Cloud Armor       │
                      └────────┬─────────────┘
                               │
                 ┌─────────────┴──────────────┐
                 │                            │
         ┌───────▼───────┐           ┌────────▼─────────┐
         │  Cloud Run    │           │  Cloud Storage   │
         │  API          │           │  Frontend (MR)   │
         │  min:3 max:20 │           │  + CDN           │
         │  4vCPU / 4GB  │           └──────────────────┘
         └───────┬───────┘
                 │
     ┌───────────┼────────────────┬────────────────┐
     │           │                │                │
┌────▼─────┐ ┌──▼─────┐  ┌──────▼───────┐  ┌─────▼──────┐
│Cloud SQL │ │Pub/Sub │  │Cloud Run     │  │Memorystore │
│Primary   │ │        │  │Workers       │  │Redis 5GB   │
│8vCPU/32GB│ │3 topics│──│min:3 max:30  │  │Standard HA │
│HA + 1    │ │sub/    │  │4vCPU / 4GB   │  │            │
│read      │ │retry/  │  │              │  │shared cache│
│replica   │ │dead-   │  │3 worker types│  │rate limits │
└──────────┘ │letter  │  └──────┬───────┘  └────────────┘
             └────────┘         │
                         ┌──────▼──────┐
                         │  LLM Layer  │
                         │  (fallback  │
                         │  + routing) │
                         │             │
                         │  Gemini ──primary
                         │  OpenAI ──fallback
                         │             │
                         │  real-time  │
                         │  + batch    │
                         └─────────────┘
```

### What's Different from 10K

**Database: HA + Read Replica**

At 100K, roughly 70% of database queries are reads (`GET /matches`, `GET /matches/{id}`, polling). A read replica offloads those, keeping the primary focused on writes (INSERT jobs, UPDATE results).

I'd also add **PgBouncer** as a sidecar — 30 concurrent workers + 20 API instances = 50+ connections. Without pooling, you hit Cloud SQL connection limits fast.

**Workers: Separate by Type**

Not all work is equal. I'd split workers into three types:
- **Parsing workers** (lightweight): resume extraction, JD extraction — fast, low memory
- **Agent workers** (heavy): full LangGraph pipeline — 15-20s, needs more CPU for concurrent LLM calls
- **Export workers** (async): cover letters, PDF generation, batch re-scoring — not time-sensitive

This makes scaling more predictable. If JD extraction is the bottleneck, scale parsing workers only.

**Pub/Sub: Multiple Topics**

```
pelgo-jobs-submit    → main agent workers (real-time)
pelgo-jobs-retry     → retry with exponential backoff (Pub/Sub handles this natively)
pelgo-jobs-deadletter → failed after 3 attempts, needs human review
pelgo-jobs-batch     → non-urgent work (re-scoring, bulk analysis)
```

**LLM: Real-time + Batch**

Gemini Batch API costs 50% less ($0.05 input, $0.20 output per 1M tokens). For non-urgent operations:
- Re-scoring after profile update
- Bulk JD analysis for "recommended jobs" feature
- Nightly re-research of skill resources (refresh links)

I'd route ~30% of LLM calls through batch, saving ~15% on total LLM cost.

**LLM Resilience: Multi-Provider Fallback + Model Routing**

This applies to both 10K and 100K, but becomes critical at scale: **if Gemini goes down for 30 minutes during peak, every agent job fails.** That's not acceptable.

I've built an abstraction layer (`app/llm.py`) that handles two things:

*1. Automatic provider failover:*

```
call_llm() → try Gemini → if timeout/500/rate-limit → try OpenAI (gpt-4o-mini) → if all fail → raise
```

The fallback is opt-in — set `OPENAI_API_KEY` and it activates. Without it, behavior is unchanged. Logs clearly show when a fallback fires (`llm_provider_failed`, `llm_call_success provider=openai`), so we know if Gemini is having issues.

*2. Model routing by task complexity:*

Not all tasks need the same model. A JD extraction is straightforward — cheap model handles it. Scoring needs nuanced judgment.

| Tool | Complexity | Default Model | Can Upgrade To |
|------|-----------|---------------|----------------|
| extract_jd_requirements | **Light** | flash-lite ($0.10/1M in) | — |
| prioritise_skill_gaps | **Light** | flash-lite | — |
| research_skill_resources | **Light** | flash-lite | — |
| score_candidate | **Standard** | flash-lite | gemini-2.0-flash |
| Resume parsing | **Standard** | flash-lite | gemini-2.0-flash |
| Low-confidence re-scoring | **Heavy** | gemini-2.0-flash | gemini-2.5-pro |

Right now all tiers use flash-lite because it's been reliable. But the routing is in place — upgrading scoring quality is a config change, not a code change. And it prevents accidentally sending simple extraction tasks to expensive models when we do upgrade.

At 100K users, this also enables a **cost-aware strategy**: spend more on scoring (where quality matters) and less on extraction (where it doesn't). If we route 70% light + 30% standard, the extra cost is only ~$35/mo for meaningfully better scoring.

**Shared Cache (Redis)**

The current in-memory cache dies with each container. At 100K, the same JD gets submitted by many users. A Redis-backed shared cache means:
- JD extraction: cache by content hash → skip LLM call entirely
- Skill research: cache by (skill, seniority) → skip external API + LLM
- Estimated 20-30% reduction in LLM calls

**Cloud Armor + Rate Limiting**

At 100K, you need abuse protection. Cloud Armor blocks DDoS, and Redis-backed rate limiting prevents one user from submitting 1,000 JDs and burning through LLM budget.

### Cost Estimate: 100K Users

| Service | Spec | Monthly Cost |
|---------|------|-------------|
| **Cloud Run — API** | 4vCPU/4GB, min 3 always-on + burst | $750 |
| **Cloud Run — Agent Workers** | 4vCPU/4GB, event-driven, min 3 max 30 | $900 |
| **Cloud Run — Parsing/Export Workers** | 2vCPU/2GB, event-driven | $150 |
| **Cloud SQL Primary** | db-custom-8-32768, HA | $810 |
| **Cloud SQL Read Replica** | db-custom-4-16384 | $200 |
| **Cloud SQL Storage** | 100GB SSD | $22 |
| **Memorystore Redis** | Standard 5GB HA | $197 |
| **Vertex AI — Real-time (70%)** | 210K runs × ~5.5K tokens | $480 |
| **Vertex AI — Batch (30%)** | 90K runs × 50% discount | $103 |
| **Other LLM** (resume parse, CV, etc.) | | $100 |
| **Pub/Sub** | ~300K messages + retries | $2 |
| **Cloud LB + Cloud Armor** | 2 rules + WAF | $55 |
| **Cloud CDN + Storage** | ~1TB/mo multi-region | $80 |
| **Logging & Monitoring** | ~100GB/mo, dashboards, alerts | $50 |
| | | |
| **Total** | | **~$3,899/mo** |

---

## Side-by-Side Comparison

| | 10K Users | 100K Users |
|---|---|---|
| **Monthly cost** | ~$508 | ~$3,899 |
| **Annual cost** | ~$6,096 | ~$46,788 |
| **Per user/month** | $0.051 | $0.039 |
| **Cost multiplier** | 1x | 7.7x (not 10x — economies of scale) |

### Where the Money Goes

```
10K Users ($508/mo)               100K Users ($3,899/mo)
─────────────────                 ──────────────────────
Compute     37%  $190             Compute     46%  $1,800
Database    39%  $200             Database    26%  $1,032
LLM         14%  $70              LLM         18%  $683
Network      6%  $28              Network      3%  $135
Other        4%  $20              Other        6%  $249
```

The interesting thing: **LLM is never the biggest cost driver.** Even at 100K users, Gemini 2.5 Flash Lite is cheap enough that compute and database dominate. This is different from what people assume — everyone worries about LLM costs, but at $0.10/1M input tokens, it's not the bottleneck.

That said, if we switched to a more expensive model (GPT-4o at ~$2.50/1M input), LLM would be 10x more and become the #1 cost. The model choice matters a lot.

---

## Optimization Levers (If We Need to Cut Costs)

| Strategy | Saves | Trade-off | When |
|----------|-------|-----------|------|
| **Cloud SQL Committed Use (1yr)** | 25% on DB ($50-250/mo) | Locked to instance size | After traffic stabilizes |
| **Batch API for more operations** | Up to 50% on LLM | Slower results for batched work | When users accept async |
| **Two-stage agent pipeline** | ~30% fewer LLM calls | More code complexity | If LLM cost exceeds 25% of total |
| **Smaller model for extraction** | ~40% on tool 1 | Possible quality drop | Test quality first |
| **Shared Redis cache** | ~20-30% fewer LLM calls | Need Redis HA | Phase 2 |
| **Workers scale to zero at night** | ~30% compute savings | Cold starts for night users | If usage is timezone-clustered |

The two-stage pipeline idea is worth explaining: right now, every JD goes through the full 4-tool agent. But many JDs are straightforward — senior React developer, 5+ years, standard tech stack. For those, a lighter scoring pass (single LLM call) might be enough. Only ambiguous or low-confidence cases would go through the full agent. This could cut LLM calls by 30-40%.

---

## Migration Roadmap

### Phase 1: Production Launch (Month 1-2)
- Deploy current code to Cloud Run (API + workers)
- Replace Redis signaling with Pub/Sub
- Cloud SQL HA (even at 10K — insurance against downtime)
- Cloud Storage + CDN for frontend
- Basic monitoring: uptime checks, error rate alerts
- **Cost: ~$508/mo**

### Phase 2: Growth (Month 3-6, heading toward 50K)
- Move JD extraction cache to Redis (shared across workers)
- Add PgBouncer for connection pooling
- Split workers by type (parsing vs agent vs export)
- Add Cloud Armor + rate limiting
- Implement Batch API for non-urgent operations
- **Cost: ~$2,000/mo at 50K**

### Phase 3: Scale (Month 7-12, heading toward 100K)
- Add Cloud SQL read replica
- Upgrade primary to db-custom-8-32768
- Redis Standard 5GB HA
- Multi-region frontend
- WebSocket notifications via Pub/Sub (replace frontend polling)
- Comprehensive SLO monitoring and error budgets
- **Cost: ~$3,899/mo at 100K**

---

## LLM Resilience: Multi-Provider Fallback & Model Routing

One thing the MVP doesn't handle well: **if Gemini goes down, the entire system stops.** Every tool, every resume parse, every scoring call goes through a single provider. That's a single point of failure.

I've implemented an **LLM abstraction layer** (`app/llm.py`) that solves two problems at once:

### Problem 1: Provider Failover

```
User submits JD → Agent calls extract_jd → call_llm()
                                              │
                                    ┌─────────▼─────────┐
                                    │  Try Gemini first  │
                                    └─────────┬─────────┘
                                              │
                                     success? ─── YES → return result
                                              │
                                             NO (timeout / rate limit / 500)
                                              │
                                    ┌─────────▼──────────┐
                                    │  Fallback: OpenAI  │
                                    │  (gpt-4o-mini)     │
                                    └─────────┬──────────┘
                                              │
                                     success? ─── YES → return result
                                              │
                                             NO → raise error (all providers down)
```

The code is simple — `call_gemini()` still works everywhere (backward compatible), but now it routes through `call_llm()` which tries providers in order:

```python
PROVIDER_CHAIN = [
    ("gemini", _call_gemini),     # primary — cheapest, fastest
    ("openai", _call_openai),     # fallback — only if Gemini fails
]
```

**What triggers a fallback:**
- Gemini timeout (>30s)
- Gemini rate limit (429)
- Gemini server error (500/503)
- Any unhandled exception from the Gemini SDK

**What does NOT trigger a fallback:**
- Bad JSON output → handled by existing `validate_or_retry` logic
- Low confidence → handled by existing `handle_low_confidence` logic

The fallback is **opt-in** — only active if `OPENAI_API_KEY` is set in env. Without it, behavior is identical to before (Gemini only, fails normally on error).

### Problem 2: Model Routing by Task Complexity

Not all tasks need the same model. Extracting a JD is straightforward — a cheap model does it fine. Scoring a candidate requires more nuanced judgment.

```python
class TaskComplexity(str, Enum):
    LIGHT = "light"       # cheap fast model
    STANDARD = "standard" # balanced model
    HEAVY = "heavy"       # best available model
```

How each tool is routed:

| Tool | Complexity | Model (current) | Model (can upgrade to) | Why |
|------|-----------|-----------------|----------------------|-----|
| `extract_jd_requirements` | **LIGHT** | gemini-2.5-flash-lite | — | Straightforward extraction, structured output |
| `prioritise_skill_gaps` | **LIGHT** | gemini-2.5-flash-lite | — | Simple ranking task |
| `research_skill_resources` | **LIGHT** | gemini-2.5-flash-lite | — | Synthesize search results, not complex reasoning |
| `score_candidate` | **STANDARD** | gemini-2.5-flash-lite | gemini-2.0-flash | Needs nuanced judgment on skill equivalency |
| Resume parsing | **STANDARD** | gemini-2.5-flash-lite | gemini-2.0-flash | Complex document understanding |
| Low-confidence re-scoring | **HEAVY** | gemini-2.0-flash | gemini-2.5-pro | Hard cases need the best model |

Right now all three tiers use the same model (flash-lite) because it's been reliable enough. But the routing is in place — when we want to upgrade scoring quality, we change one config value:

```bash
GEMINI_MODEL=gemini-2.5-flash-lite       # light + standard tasks
GEMINI_MODEL_HEAVY=gemini-2.0-flash      # heavy tasks (re-scoring, edge cases)
```

### Cost Impact of Model Routing

If we split 70% of calls to flash-lite and 30% to flash at 100K users:

| Scenario | Monthly LLM Cost | Savings |
|----------|-----------------|---------|
| All flash-lite (current) | $585 | baseline |
| 70% flash-lite + 30% flash | $620 | +$35 (slightly more, but better quality for scoring) |
| All flash (if we needed quality) | $700 | would be +$115 without routing |

The routing **prevents overspending** — we only send complex tasks to expensive models, not everything.

### Adding More Providers (Future)

The abstraction layer makes it easy to add more fallback providers:

```python
# Future: add Claude, Groq, local models
PROVIDER_CHAIN = [
    ("gemini", _call_gemini),       # primary
    ("openai", _call_openai),       # fallback 1
    ("anthropic", _call_claude),    # fallback 2 (easy to add)
]
```

Or even route by provider based on task type — use Gemini for extraction (good at structured output), Claude for scoring (good at nuanced reasoning), etc.

---

## Biggest Risks and What I'd Watch

1. **LLM rate limits during traffic spikes** — Vertex AI has per-minute quotas. At 3x peak, we'd hit ~60 concurrent LLM calls. Need to request quota increase proactively, and use Pub/Sub backpressure to smooth bursts.

2. **Agent run time variance** — most runs take 15-20s, but external API calls (DuckDuckGo, GitHub) can spike to 30s+. Cloud Run has a 5-minute timeout by default, which is fine, but monitoring p99 latency matters.

3. **The real unknown is user behavior** — if users submit 10 JDs instead of 3, costs jump 3x. Rate limiting per user (e.g., 20 JDs/day on free tier) is essential before scaling.

4. **Database connection exhaustion** — the most common silent failure. At 100K, without PgBouncer, one burst of 50 concurrent workers can exhaust Cloud SQL's connection limit. This causes cascading failures that look like random 500 errors.

---

## Final Thought

The architecture doesn't need to be complex to handle 100K users. The core pipeline — parse JD, score candidate, find resources — is fundamentally the same at 10K and 100K. What changes is the plumbing around it:

- **Queue**: PostgreSQL polling → Pub/Sub (reliability + instant trigger)
- **Database**: single instance → HA + read replica (availability + read throughput)  
- **Cache**: in-memory → Redis shared (efficiency across workers)
- **LLM**: single provider → multi-provider fallback + model routing (resilience + cost control)
- **LLM billing**: all real-time → real-time + batch (cost optimization)
- **Monitoring**: basic logs → SLOs, alerts, dashboards (operational maturity)

Two architectural levers matter most:

1. **Caching and deduplication** — if 100 users submit the same "Senior React Developer at Stripe" JD, you should extract it once and score 100 times. That single optimization reduces LLM cost more than any model switch.

2. **LLM resilience** — a multi-provider fallback means Gemini downtime doesn't become Pelgo downtime. And model routing means we spend budget where it matters (scoring) and save where it doesn't (extraction).
