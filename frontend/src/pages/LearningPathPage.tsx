import { useState, useEffect, useMemo } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useCandidate } from '../context/CandidateContext';
import { getMatch } from '../lib/api';
import type { MatchJob, LearningPlanEntry } from '../lib/api';
import Icon from '../components/shared/Icon';
import InsightCard from '../components/shared/InsightCard';
import PriorityBadge from '../components/shared/PriorityBadge';
import ResourceCard from '../components/shared/ResourceCard';

function SkeletonBlock({ className }: { className: string }) {
  return <div className={`animate-pulse bg-surface-container-high rounded-xl ${className}`} />;
}

function LoadingSkeleton() {
  return (
    <div className="space-y-8">
      <SkeletonBlock className="h-8 w-48" />
      <SkeletonBlock className="h-10 w-96" />
      <SkeletonBlock className="h-24 w-full" />
      {[1, 2, 3].map((i) => (
        <div key={i} className="space-y-4">
          <SkeletonBlock className="h-8 w-64" />
          <div className="grid grid-cols-2 gap-4">
            <SkeletonBlock className="h-40" />
            <SkeletonBlock className="h-40" />
          </div>
        </div>
      ))}
    </div>
  );
}

function priorityLevel(rank: number): 'high' | 'medium' | 'low' {
  if (rank === 1) return 'high';
  if (rank === 2) return 'medium';
  return 'low';
}

function getAssessmentScore(skill: string): number | null {
  try {
    const data = JSON.parse(localStorage.getItem(`pelgo_assessment_${skill}`) || '[]');
    if (data.length === 0) return null;
    return Math.max(...data.map((r: { score: number }) => r.score));
  } catch { return null; }
}

function SkillSection({ entry, index, seniority }: { entry: LearningPlanEntry; index: number; seniority: string }) {
  const bestScore = useMemo(() => getAssessmentScore(entry.skill), [entry.skill]);
  return (
    <section className="relative">
      {/* Connector line */}
      <div className="absolute left-5 top-12 bottom-0 w-px bg-surface-container-highest hidden lg:block" />

      <div className="flex items-start gap-5">
        {/* Number circle */}
        <div className="w-10 h-10 rounded-full bg-primary flex items-center justify-center shrink-0">
          <span className="text-on-primary font-extrabold text-sm">{index + 1}</span>
        </div>

        <div className="flex-1 space-y-4">
          {/* Skill header */}
          <div className="flex flex-wrap items-center gap-3">
            <h3 className="text-xl font-extrabold text-primary">{entry.skill}</h3>
            <PriorityBadge level={priorityLevel(entry.priority_rank)} />
            <span className="px-3 py-1 text-[10px] font-bold rounded-full uppercase tracking-wider bg-tertiary-container text-tertiary-fixed">
              Match gain: +{entry.estimated_match_gain_pct}%
            </span>
          </div>

          {/* Rationale */}
          {entry.rationale && (
            <p className="text-sm text-on-surface-variant leading-relaxed max-w-2xl">
              {entry.rationale}
            </p>
          )}

          {/* Resource cards grid */}
          {entry.resources.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {entry.resources.map((resource, ri) => (
                <ResourceCard
                  key={ri}
                  title={resource.title}
                  url={resource.url}
                  hours={resource.estimated_hours}
                  type={resource.type}
                />
              ))}
            </div>
          ) : (
            <p className="text-sm text-on-surface-variant italic">No resources available for this skill yet.</p>
          )}

          {/* Assessment CTA */}
          <div className="flex items-center gap-4 pt-2">
            <Link
              to={`/assessment?skill=${encodeURIComponent(entry.skill)}&seniority=${seniority}`}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-secondary text-on-secondary text-xs font-bold hover:opacity-90 transition-opacity"
            >
              <Icon name="quiz" size="sm" />
              {bestScore !== null ? 'Retake Assessment' : 'Take Assessment'}
            </Link>
            {bestScore !== null && (
              <div className="flex items-center gap-2">
                <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-extrabold ${
                  bestScore >= 80 ? 'bg-tertiary-fixed/20 text-on-tertiary-container' : bestScore >= 60 ? 'bg-secondary-fixed text-secondary' : 'bg-error-container text-on-error-container'
                }`}>
                  {bestScore}
                </div>
                <span className={`text-xs font-bold ${bestScore >= 60 ? 'text-on-tertiary-container' : 'text-on-surface-variant'}`}>
                  {bestScore >= 80 ? 'Proficient' : bestScore >= 60 ? 'Passed' : 'Needs Practice'}
                </span>
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

export default function LearningPathPage() {
  const { jobId } = useParams<{ jobId: string }>();
  const { candidate, matches } = useCandidate();
  const [match, setMatch] = useState<MatchJob | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!jobId) return;

    const cached = matches.find((m) => m.job_id === jobId);
    if (cached) {
      setMatch(cached);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    getMatch(jobId)
      .then((data) => {
        if (!cancelled) {
          setMatch(data);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load match');
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [jobId, matches]);

  const result = match?.result;
  const learningPlan = result?.learning_plan ?? [];
  const totalSkills = learningPlan.length;
  const totalHours = learningPlan.reduce(
    (sum, entry) => sum + entry.resources.reduce((s, r) => s + r.estimated_hours, 0),
    0
  );

  return (
    <div>
      {loading && <LoadingSkeleton />}

      {!loading && error && (
        <div className="flex flex-col items-center justify-center py-24 space-y-6">
          <div className="w-20 h-20 bg-error-container rounded-full flex items-center justify-center">
            <Icon name="error" size="lg" className="text-on-error-container" />
          </div>
          <div className="text-center space-y-2 max-w-md">
            <h2 className="text-2xl font-extrabold text-primary">Could Not Load Learning Plan</h2>
            <p className="text-on-surface-variant text-sm leading-relaxed">{error}</p>
          </div>
          <Link
            to={`/matches/${jobId}`}
            className="px-6 py-3 bg-secondary text-on-primary font-bold rounded-xl text-sm hover:opacity-90 transition-opacity"
          >
            Return to Analysis
          </Link>
        </div>
      )}

      {!loading && !error && match && (
        <>
          {/* Header */}
          <div className="flex flex-col sm:flex-row items-start gap-6 mb-8">
            <Link to={`/matches/${jobId}`}
              className="px-5 py-3 bg-gradient-to-r from-primary to-secondary text-on-primary font-bold rounded-xl text-sm hover:opacity-90 transition-opacity flex items-center gap-2 shrink-0"
            >
              <Icon name="arrow_back" size="sm" />
              Back to Analysis
            </Link>
            <div>
              <span className="inline-block px-3 py-1 text-[10px] font-bold rounded-full uppercase tracking-wider bg-secondary-fixed text-secondary mb-3">
                Target Role Path
              </span>
              <h1 className="text-3xl font-extrabold text-primary leading-tight">
                Your Learning Roadmap
                {totalSkills > 0 && (
                  <span className="text-secondary"> &middot; {totalSkills} skill{totalSkills !== 1 ? 's' : ''}</span>
                )}
              </h1>
              {totalHours > 0 && (
                <p className="text-sm text-on-surface-variant mt-2 flex items-center gap-1.5">
                  <Icon name="schedule" size="sm" />
                  Estimated {totalHours} hours total learning time
                </p>
              )}
            </div>
          </div>

          {/* Intelligence Rationale */}
          {learningPlan.length > 0 && (
            <div className="mb-10">
              <InsightCard title="Prioritization Logic" variant="info">
                Skills are ordered by potential match score improvement. Focusing on the highest-priority
                skills first will give you the greatest return on your learning investment. Each skill
                includes an estimated match gain percentage based on the gap analysis.
              </InsightCard>
            </div>
          )}

          {/* Skill Sections */}
          {learningPlan.length > 0 ? (
            <div className="space-y-10">
              {learningPlan
                .sort((a, b) => a.priority_rank - b.priority_rank)
                .map((entry, i) => (
                  <SkillSection key={entry.skill} entry={entry} index={i} seniority={candidate?.seniority_level || 'mid'} />
                ))}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-20 space-y-4">
              <div className="w-16 h-16 bg-surface-container-high rounded-full flex items-center justify-center">
                <Icon name="menu_book" size="lg" className="text-on-surface-variant" />
              </div>
              <p className="text-on-surface-variant text-sm font-semibold">
                No learning plan available for this match.
              </p>
              <Link
                to={`/matches/${jobId}`}
                className="text-secondary text-sm font-bold hover:underline"
              >
                Return to analysis
              </Link>
            </div>
          )}

          {/* Footer CTA */}
          {learningPlan.length > 0 && (
            <div className="mt-16 bg-primary-container rounded-2xl p-10 flex flex-col sm:flex-row items-center justify-between gap-6">
              <div>
                <h2 className="text-2xl font-extrabold text-on-primary mb-2">Ready to accelerate?</h2>
                <p className="text-sm text-on-primary-container max-w-md">
                  Keep your career profile up to date so we can continuously refine your learning roadmap
                  and match scores.
                </p>
              </div>
              <Link
                to="/upload"
                className="px-8 py-4 bg-tertiary-fixed text-on-tertiary-container font-bold rounded-xl text-sm hover:opacity-90 transition-opacity flex items-center gap-2 shrink-0"
              >
                <Icon name="upload" size="sm" />
                Update Career Profile
              </Link>
            </div>
          )}
        </>
      )}
    </div>
  );
}
