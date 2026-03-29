import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useCandidate } from '../context/CandidateContext';
import { getMatch } from '../lib/api';
import type { MatchJob, AgentTrace } from '../lib/api';
import StatCard from '../components/shared/StatCard';
import InsightCard from '../components/shared/InsightCard';
import Breadcrumb from '../components/shared/Breadcrumb';
import Icon from '../components/shared/Icon';

const TOOL_DESCRIPTIONS: Record<string, string> = {
  extract_jd_requirements: 'Parsed job description into structured requirements',
  score_candidate_against_requirements: 'Scored candidate against extracted requirements',
  prioritise_skill_gaps: 'Ranked skill gaps by impact and market demand',
  research_skill_resources: 'Researched learning resources for skill gaps',
};

function SkeletonBlock({ className }: { className?: string }) {
  return <div className={`animate-pulse bg-surface-container-high rounded-xl ${className ?? ''}`} />;
}

function TimelineStep({
  step,
  index,
}: {
  step: AgentTrace['tool_calls'][number];
  index: number;
}) {
  const isSuccess = step.status.toLowerCase() === 'success';
  const description = TOOL_DESCRIPTIONS[step.tool] ?? `Executed tool: ${step.tool}`;

  return (
    <div className="relative pl-12 pb-8 last:pb-0">
      {/* Numbered circle */}
      <div className="absolute left-0 top-0 w-8 h-8 rounded-full bg-primary text-on-primary flex items-center justify-center text-xs font-bold z-10">
        {index + 1}
      </div>

      {/* Card */}
      <div className="bg-surface-container-lowest p-6 rounded-xl">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 min-w-0">
            <h4 className="font-bold text-primary font-mono text-sm mb-1">{step.tool}</h4>
            <p className="text-sm text-on-surface-variant">{description}</p>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {/* Status badge */}
            <span
              className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-bold uppercase tracking-wider ${
                isSuccess
                  ? 'bg-tertiary-fixed-dim/20 text-on-tertiary-container'
                  : 'bg-error-container text-on-error-container'
              }`}
            >
              <Icon name={isSuccess ? 'check_circle' : 'error'} size="sm" />
              {step.status}
            </span>

            {/* Latency badge */}
            <span className="px-2.5 py-1 rounded-full bg-surface-container-high text-on-surface-variant text-[11px] font-mono font-semibold">
              {step.latency_ms}ms
            </span>
          </div>
        </div>

        {/* Error detail */}
        {step.error && (
          <div className="mt-3 p-3 rounded-lg bg-error-container text-on-error-container text-xs font-mono leading-relaxed">
            {step.error}
          </div>
        )}
      </div>
    </div>
  );
}

export default function AgentTracePage() {
  const { jobId } = useParams<{ jobId: string }>();
  const { matches } = useCandidate();
  const [match, setMatch] = useState<MatchJob | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [jsonExpanded, setJsonExpanded] = useState(true);

  useEffect(() => {
    if (!jobId) return;

    // Try to find in context first
    const cached = matches.find((m) => m.job_id === jobId);
    if (cached) {
      setMatch(cached);
      setLoading(false);
      return;
    }

    // Otherwise fetch
    let cancelled = false;
    setLoading(true);
    getMatch(jobId)
      .then((data) => {
        if (!cancelled) {
          setMatch(data);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err.message);
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [jobId, matches]);

  const agentTrace: AgentTrace | null =
    match?.result?.agent_trace ?? match?.agent_trace ?? null;

  const totalLatencyMs = agentTrace
    ? agentTrace.tool_calls.reduce((sum, tc) => sum + tc.latency_ms, 0)
    : 0;
  const totalLatencyFormatted = `${(totalLatencyMs / 1000).toFixed(1)}s`;

  const isOptimal =
    agentTrace &&
    agentTrace.total_llm_calls <= 5 &&
    agentTrace.fallbacks_triggered === 0;
  const efficiencyScore = isOptimal ? 75 : agentTrace ? Math.max(30, 75 - agentTrace.fallbacks_triggered * 15) : 0;

  const shortId = jobId?.slice(0, 8) ?? '--------';

  // Loading skeleton
  if (loading) {
    return (
      <div className="space-y-8">
        <SkeletonBlock className="h-4 w-64" />
        <SkeletonBlock className="h-10 w-96" />
        <div className="grid grid-cols-3 gap-6">
          <SkeletonBlock className="h-28" />
          <SkeletonBlock className="h-28" />
          <SkeletonBlock className="h-28" />
        </div>
        <div className="grid grid-cols-12 gap-8">
          <div className="col-span-8 space-y-4">
            <SkeletonBlock className="h-32" />
            <SkeletonBlock className="h-32" />
            <SkeletonBlock className="h-32" />
          </div>
          <div className="col-span-4 space-y-4">
            <SkeletonBlock className="h-64" />
            <SkeletonBlock className="h-40" />
          </div>
        </div>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="flex items-center justify-center min-h-[50vh]">
        <div className="text-center space-y-3">
          <Icon name="error" size="lg" className="text-error" />
          <p className="text-on-surface-variant">{error}</p>
          <Link to="/" className="text-primary font-semibold text-sm hover:underline">
            Back to Dashboard
          </Link>
        </div>
      </div>
    );
  }

  // No trace data
  if (!agentTrace) {
    return (
      <div className="space-y-6">
        <Breadcrumb
          items={[
            { label: 'PROJECTS', to: '/' },
            { label: 'AGENT_PELGO_V2', to: '/' },
            { label: 'TRACES' },
          ]}
        />
        <div className="flex items-center justify-center min-h-[40vh]">
          <div className="text-center space-y-3">
            <Icon name="blur_on" size="lg" className="text-on-surface-variant" />
            <p className="text-on-surface-variant font-semibold">No trace data available for this match.</p>
            <Link
              to={`/matches/${jobId}`}
              className="text-primary font-semibold text-sm hover:underline inline-flex items-center gap-1"
            >
              <Icon name="arrow_back" size="sm" />
              Back to Job Analysis
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Back nav */}
      <Link to={`/matches/${jobId}`} className="inline-flex items-center gap-1.5 text-sm font-bold text-on-surface-variant hover:text-secondary transition-colors">
        <Icon name="arrow_back" size="sm" />
        Back to Analysis
      </Link>

      {/* 2. Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-extrabold text-on-surface tracking-tight">
          Agent Trace{' '}
          <span className="text-primary font-mono text-xl">#{shortId}</span>
        </h1>
        <div className="flex items-center gap-3">
          <button className="px-4 py-2 rounded-xl border border-outline text-on-surface text-sm font-semibold hover:bg-surface-container-high transition-colors flex items-center gap-2">
            <Icon name="replay" size="sm" />
            Re-run Trace
          </button>
          <button className="px-4 py-2 rounded-xl bg-gradient-to-r from-primary to-secondary text-on-primary text-sm font-semibold hover:opacity-90 transition-opacity flex items-center gap-2">
            <Icon name="download" size="sm" />
            Export
          </button>
        </div>
      </div>

      {/* 3. Stats Grid */}
      <div className="grid grid-cols-3 gap-6">
        <StatCard
          label="Total LLM Calls"
          value={agentTrace.total_llm_calls}
          trend={agentTrace.total_llm_calls <= 5 ? 'Optimal' : `${agentTrace.total_llm_calls - 5} over target`}
          icon={agentTrace.total_llm_calls <= 5 ? 'check_circle' : 'warning'}
        />
        <StatCard
          label="Total Latency"
          value={totalLatencyFormatted}
          trend={totalLatencyMs < 5000 ? 'Within budget' : 'Over budget'}
          icon="timer"
        />
        <StatCard
          label="Fallbacks"
          value={agentTrace.fallbacks_triggered === 0 ? 'None' : agentTrace.fallbacks_triggered}
          trend={agentTrace.fallbacks_triggered === 0 ? 'Clean execution' : `${agentTrace.fallbacks_triggered} triggered`}
          icon={agentTrace.fallbacks_triggered === 0 ? 'verified' : 'sync_problem'}
        />
      </div>

      {/* 4. Main Content: Timeline + Inspect Panel */}
      <div className="grid grid-cols-12 gap-8">
        {/* Left: Execution Timeline */}
        <div className="col-span-8">
          <h2 className="text-lg font-extrabold text-on-surface mb-6 flex items-center gap-2">
            <Icon name="timeline" className="text-secondary" />
            Execution Timeline
          </h2>
          <div className="relative border-l border-surface-container-high ml-4">
            {agentTrace.tool_calls.map((step, i) => (
              <TimelineStep key={`${step.tool}-${i}`} step={step} index={i} />
            ))}
          </div>
        </div>

        {/* Right: Inspect Panel */}
        <div className="col-span-4">
          <div className="sticky top-24 space-y-6">
            {/* Raw JSON Output */}
            <div className="bg-surface-container-lowest rounded-xl overflow-hidden">
              <div className="flex items-center justify-between p-4 border-b border-surface-container-high">
                <h3 className="text-sm font-bold text-on-surface flex items-center gap-2">
                  <Icon name="data_object" size="sm" className="text-primary" />
                  Raw JSON Output
                </h3>
                <button
                  onClick={() => setJsonExpanded(!jsonExpanded)}
                  className="p-1.5 rounded-lg hover:bg-surface-container-high transition-colors"
                >
                  <Icon name={jsonExpanded ? 'unfold_less' : 'unfold_more'} size="sm" className="text-on-surface-variant" />
                </button>
              </div>
              {jsonExpanded && (
                <div className="p-4 max-h-96 overflow-auto">
                  <pre>
                    <code className="bg-primary-container text-blue-200 font-mono text-[11px] block p-3 rounded-lg whitespace-pre-wrap break-all">
                      {JSON.stringify(agentTrace, null, 2)}
                    </code>
                  </pre>
                </div>
              )}
            </div>

            {/* Efficiency Analysis */}
            <InsightCard title="Efficiency Analysis">
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-on-surface-variant uppercase tracking-wider">
                    Status
                  </span>
                  <span
                    className={`text-xs font-bold px-2 py-0.5 rounded-full ${
                      isOptimal
                        ? 'bg-tertiary-fixed-dim/20 text-on-tertiary-container'
                        : 'bg-secondary-container text-on-secondary-container'
                    }`}
                  >
                    {isOptimal ? 'Optimal' : 'Sub-optimal'}
                  </span>
                </div>

                {/* Progress bar */}
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-xs text-on-surface-variant">Efficiency Score</span>
                    <span className="text-xs font-mono font-bold text-primary">{efficiencyScore}%</span>
                  </div>
                  <div className="w-full h-2 bg-surface-container-high rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-primary to-tertiary-fixed-dim transition-all duration-500"
                      style={{ width: `${efficiencyScore}%` }}
                    />
                  </div>
                </div>

                <div className="text-xs text-on-surface-variant leading-relaxed space-y-1 pt-1">
                  <p>
                    <span className="font-semibold">LLM Calls:</span> {agentTrace.total_llm_calls}{' '}
                    {agentTrace.total_llm_calls <= 5 ? '(within target)' : '(over target of 5)'}
                  </p>
                  <p>
                    <span className="font-semibold">Fallbacks:</span>{' '}
                    {agentTrace.fallbacks_triggered === 0
                      ? 'None triggered'
                      : `${agentTrace.fallbacks_triggered} triggered`}
                  </p>
                  <p>
                    <span className="font-semibold">Tools executed:</span> {agentTrace.tool_calls.length}
                  </p>
                </div>
              </div>
            </InsightCard>
          </div>
        </div>
      </div>
    </div>
  );
}
