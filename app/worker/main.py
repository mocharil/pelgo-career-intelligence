"""Background worker — out-of-process agent execution with race-safe job claiming.

Uses PostgreSQL SELECT ... FOR UPDATE SKIP LOCKED for atomic job claiming.
Redis is used only for signaling (new job notifications).
"""

from __future__ import annotations

import asyncio
import json
import os
import signal
import sys
import time
import traceback

import structlog

# Allow running as module
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(__file__))))

from app.logging_config import setup_logging
setup_logging()

from sqlalchemy import text, update
from sqlalchemy.orm import Session

from app.config import settings
from app.db.session import SyncSessionLocal, sync_engine
from app.db.tables import CandidateTable, MatchJobTable

logger = structlog.get_logger()

POLL_INTERVAL = 2  # seconds between polls when no Redis signal
MAX_RETRIES = 3
WORKER_ID = f"worker-{os.getpid()}"


def claim_job(session: Session) -> MatchJobTable | None:
    """Atomically claim a pending job using SELECT ... FOR UPDATE SKIP LOCKED.

    This ensures multiple workers can run concurrently without claiming
    the same job (race-condition safe).
    """
    result = session.execute(
        text("""
            SELECT id FROM match_jobs
            WHERE status = 'pending'
            ORDER BY created_at ASC
            LIMIT 1
            FOR UPDATE SKIP LOCKED
        """)
    )
    row = result.fetchone()
    if not row:
        return None

    job_id = row[0]

    # Update status to processing
    session.execute(
        text("""
            UPDATE match_jobs
            SET status = 'processing', updated_at = NOW()
            WHERE id = :job_id
        """),
        {"job_id": job_id},
    )
    session.commit()

    # Fetch full job
    job = session.get(MatchJobTable, job_id)
    return job


def process_job(job: MatchJobTable, session: Session):
    """Run the agent for a single job. Handle failures gracefully."""
    job_id = str(job.id)
    logger.info("processing_job", job_id=job_id, worker=WORKER_ID, retry=job.retry_count)

    try:
        # Load candidate profile
        candidate = session.get(CandidateTable, job.candidate_id)
        if not candidate:
            raise ValueError(f"Candidate {job.candidate_id} not found")

        candidate_profile = {
            "name": candidate.name,
            "email": candidate.email,
            "summary": candidate.summary,
            "skills": candidate.skills,
            "experiences": candidate.experiences,
            "education": candidate.education,
            "seniority_level": candidate.seniority_level,
            "total_years_experience": candidate.total_years_experience,
        }

        # Determine JD text
        jd_text = job.job_description_text
        if not jd_text and job.job_url:
            jd_text = job.job_url  # The tool will fetch it

        # Progress callback — saves incremental trace to DB
        def on_progress(progress_data: dict):
            try:
                session.execute(
                    text("""
                        UPDATE match_jobs
                        SET agent_trace = :trace,
                            updated_at = NOW()
                        WHERE id = :job_id
                    """),
                    {
                        "trace": json.dumps(progress_data.get("agent_trace", {})),
                        "job_id": job.id,
                    },
                )
                session.commit()
                logger.info("progress_saved", job_id=job_id,
                            step=progress_data.get("current_step"))
            except Exception as e:
                logger.warning("progress_save_failed", error=str(e))

        # Run the agent (synchronous wrapper)
        from app.agent.graph import run_agent

        loop = asyncio.new_event_loop()
        try:
            result = loop.run_until_complete(
                run_agent(
                    job_id=job_id,
                    candidate_profile=candidate_profile,
                    job_description_text=jd_text,
                    job_url=job.job_url,
                    progress_callback=on_progress,
                )
            )
        finally:
            loop.close()

        # Validate result before persisting
        from app.models.schemas import MatchResult
        validated = MatchResult(**result)

        # Update job with result
        job.status = "completed"
        job.result = validated.model_dump(mode="json")
        job.agent_trace = validated.agent_trace.model_dump() if hasattr(validated.agent_trace, 'model_dump') else result.get("agent_trace", {})
        job.error_detail = None

        # If JD was from URL, backfill job_description_text from fetched content
        if not job.job_description_text and job.job_url:
            try:
                from app.tools.extract_jd import _fetch_url_content
                fetched = _fetch_url_content(job.job_url, timeout=15)
                job.job_description_text = fetched[:10000]  # cap at 10k chars
                logger.info("jd_text_backfilled", job_id=job_id, chars=len(fetched))
            except Exception as e:
                logger.warning("jd_text_backfill_failed", job_id=job_id, error=str(e))

        session.commit()

        logger.info("job_completed", job_id=job_id, score=validated.overall_score,
                     confidence=validated.confidence)

    except Exception as e:
        # Log full traceback for debugging, but only store summary in DB
        logger.error("job_failed", job_id=job_id, error=str(e), retry=job.retry_count,
                      traceback=traceback.format_exc())
        error_detail = f"{type(e).__name__}: {str(e)}"

        job.retry_count = (job.retry_count or 0) + 1

        if job.retry_count >= MAX_RETRIES:
            # Dead letter — mark as failed permanently
            job.status = "failed"
            job.error_detail = error_detail
            logger.warning("job_dead_letter", job_id=job_id, retries=job.retry_count)
        else:
            # Put back to pending for retry
            job.status = "pending"
            job.error_detail = error_detail

        session.commit()


def worker_loop():
    """Main worker loop — poll for jobs and process them."""
    logger.info("worker_started", worker=WORKER_ID, pid=os.getpid())

    running = True

    def shutdown(signum, frame):
        nonlocal running
        logger.info("worker_shutdown_signal", worker=WORKER_ID)
        running = False

    signal.signal(signal.SIGTERM, shutdown)
    signal.signal(signal.SIGINT, shutdown)

    # Optional: listen to Redis for faster notification
    redis_client = None
    try:
        import redis
        redis_client = redis.Redis.from_url(settings.redis_url)
        redis_client.ping()
        logger.info("worker_redis_connected", worker=WORKER_ID)
    except Exception as e:
        logger.warning("worker_redis_unavailable", error=str(e))
        redis_client = None

    while running:
        try:
            # Check Redis for signal (non-blocking)
            job_signal = None
            if redis_client:
                try:
                    job_signal = redis_client.rpop("pelgo:job_queue")
                except Exception:
                    pass

            # Try to claim a job from PostgreSQL
            session = SyncSessionLocal()
            try:
                job = claim_job(session)
                if job:
                    process_job(job, session)
                else:
                    # No jobs available, wait
                    time.sleep(POLL_INTERVAL)
            finally:
                session.close()

        except Exception as e:
            logger.error("worker_loop_error", error=str(e), worker=WORKER_ID)
            time.sleep(POLL_INTERVAL)

    logger.info("worker_stopped", worker=WORKER_ID)
    if redis_client:
        redis_client.close()


if __name__ == "__main__":
    worker_loop()
