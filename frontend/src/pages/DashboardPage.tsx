import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useCandidate } from '../context/CandidateContext';
import { deleteMatch } from '../lib/api';
import type { MatchJob } from '../lib/api';
import Icon from '../components/shared/Icon';
import ScoreGauge from '../components/shared/ScoreGauge';
import StatCard from '../components/shared/StatCard';
import GrowthBar from '../components/shared/GrowthBar';
import { getVerifiedSkills, isSkillVerified } from '../lib/skills';

function getMatchTitle(match: MatchJob): string {
  // 1. Try to extract from JD text (first meaningful line)
  const jd = match.job_description_text;
  if (jd) {
    const lines = jd.split('\n').map(l => l.trim()).filter(l => l.length > 3);
    for (const line of lines.slice(0, 8)) {
      if (/^(about|requirements|responsibilities|nice to have|description|we are|join|apply|the role|overview|who we)/i.test(line)) continue;
      if (line.length >= 5 && line.length <= 80) return line;
      if (line.length > 80) return line.slice(0, 77) + '...';
    }
  }
  // 2. Try URL path (e.g., /data-engineer-275911/ → "Data Engineer")
  if (match.job_url) {
    try {
      const url = new URL(match.job_url);
      const pathParts = url.pathname.split('/').filter(Boolean);
      const lastPart = pathParts[pathParts.length - 1] || '';
      // Remove IDs/numbers from slug
      const cleaned = lastPart.replace(/[-_]\d+$/g, '').replace(/[-_]/g, ' ').trim();
      if (cleaned.length >= 4) {
        const host = url.hostname.replace('www.', '').split('.')[0];
        const title = cleaned.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
        return `${title} — ${host.charAt(0).toUpperCase() + host.slice(1)}`;
      }
    } catch { /* not a valid URL */ }
  }
  // 3. Try domain from reasoning
  const reasoning = match.result?.reasoning || '';
  const domainMatch = reasoning.match(/[Dd]omain:\s*([^.]+)/);
  if (domainMatch) {
    const domain = domainMatch[1].trim();
    return `${domain.charAt(0).toUpperCase() + domain.slice(1)} Role`;
  }
  // 4. Fallback
  return match.result?.overall_score ? `Job Match — ${match.result.overall_score}%` : 'Job Match';
}

function getConfidenceColor(confidence: string): string {
  switch (confidence) {
    case 'high': return 'bg-tertiary-fixed/20 text-on-tertiary-container';
    case 'medium': return 'bg-secondary-fixed/30 text-secondary';
    case 'low': return 'bg-error-container text-on-error-container';
    default: return 'bg-surface-container text-on-surface-variant';
  }
}

const TOOL_STEP_INFO: Record<string, { label: string; activeLabel: string; icon: string }> = {
  extract_jd_requirements: {
    label: 'Reading JD',
    activeLabel: 'Reading job description...',
    icon: 'description',
  },
  score_candidate_against_requirements: {
    label: 'Matching Skills',
    activeLabel: 'Comparing your skills with requirements...',
    icon: 'compare_arrows',
  },
  prioritise_skill_gaps: {
    label: 'Analyzing Gaps',
    activeLabel: 'Identifying skill gaps & priorities...',
    icon: 'insights',
  },
  research_skill_resources: {
    label: 'Finding Courses',
    activeLabel: 'Searching learning resources...',
    icon: 'school',
  },
};

const STEP_KEYS = [
  'extract_jd_requirements',
  'score_candidate_against_requirements',
  'prioritise_skill_gaps',
  'research_skill_resources',
];

function getProcessingLabel(match: MatchJob): string {
  if (match.status === 'pending') return 'In queue — waiting for agent...';
  const trace = match.agent_trace;
  if (!trace || !trace.tool_calls || trace.tool_calls.length === 0) return 'Starting analysis...';
  const completedCount = trace.tool_calls.filter(t => t.status === 'success').length;
  const lastCall = trace.tool_calls[trace.tool_calls.length - 1];
  if (lastCall.status === 'success') {
    if (completedCount >= 4) return 'Building your report...';
    const nextTool = STEP_KEYS[completedCount];
    return TOOL_STEP_INFO[nextTool]?.activeLabel || 'Processing next step...';
  }
  return TOOL_STEP_INFO[lastCall.tool]?.activeLabel || 'Analyzing...';
}

function StatusBadge({ status, match }: { status: MatchJob['status']; match?: MatchJob }) {
  const isActive = status === 'processing' || status === 'pending';
  const config: Record<string, { icon: string; label: string; cls: string }> = {
    completed: { icon: 'check_circle', label: 'Completed', cls: 'bg-tertiary-fixed/20 text-on-tertiary-container' },
    processing: { icon: 'progress_activity', label: match ? getProcessingLabel(match) : 'Processing', cls: 'bg-secondary-fixed/30 text-secondary' },
    pending: { icon: 'schedule', label: 'Queued', cls: 'bg-surface-container-high text-on-surface-variant' },
    failed: { icon: 'error', label: 'Failed', cls: 'bg-error-container text-on-error-container' },
  };
  const c = config[status] ?? config.pending;
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-bold ${c.cls}`}>
      <span className={`material-symbols-outlined text-sm ${isActive ? 'animate-spin' : ''}`}>
        {c.icon}
      </span>
      {c.label}
    </span>
  );
}

export default function DashboardPage() {
  const { candidate, matches, loading, refreshMatches } = useCandidate();
  const navigate = useNavigate();
  const [deleting, setDeleting] = useState<string | null>(null);

  const handleDelete = async (jobId: string) => {
    if (!confirm('Delete this match? This cannot be undone.')) return;
    setDeleting(jobId);
    try {
      await deleteMatch(jobId);
      await refreshMatches();
    } catch { /* ignore */ }
    finally { setDeleting(null); }
  };

  // Derived data
  const sortedMatches = useMemo(() => {
    const completed = matches
      .filter(m => m.status === 'completed')
      .sort((a, b) => (b.result?.overall_score ?? 0) - (a.result?.overall_score ?? 0));
    const inProgress = matches.filter(m => m.status === 'processing' || m.status === 'pending');
    const failed = matches.filter(m => m.status === 'failed');
    return [...completed, ...inProgress, ...failed];
  }, [matches]);

  const activeMatches = useMemo(
    () => matches.filter(m => m.status !== 'failed').length,
    [matches],
  );

  const uniqueGapSkills = useMemo(() => {
    const gaps = new Set<string>();
    matches.forEach(m => m.result?.gap_skills?.forEach(s => gaps.add(s)));
    return gaps;
  }, [matches]);

  const verifiedSkills = useMemo(() => getVerifiedSkills(), [matches]);
  const verifiedGapCount = useMemo(() => {
    return Array.from(uniqueGapSkills).filter(s => isSkillVerified(s)).length;
  }, [uniqueGapSkills]);

  // Calculate verified skill boost per match
  const getBoost = (match: MatchJob): number => {
    if (!match.result?.learning_plan) return 0;
    return match.result.learning_plan
      .filter(entry => isSkillVerified(entry.skill))
      .reduce((sum, entry) => sum + entry.estimated_match_gain_pct, 0);
  };

  const avgScore = useMemo(() => {
    const completed = matches.filter(m => m.status === 'completed' && m.result);
    if (completed.length === 0) return 0;
    const sum = completed.reduce((acc, m) => {
      const base = m.result?.overall_score ?? 0;
      const boost = getBoost(m);
      return acc + Math.min(100, base + boost);
    }, 0);
    return Math.round(sum / completed.length);
  }, [matches]);

  const avgOriginalScore = useMemo(() => {
    const completed = matches.filter(m => m.status === 'completed' && m.result);
    if (completed.length === 0) return 0;
    return Math.round(completed.reduce((acc, m) => acc + (m.result?.overall_score ?? 0), 0) / completed.length);
  }, [matches]);

  const totalBoost = avgScore - avgOriginalScore;

  // Top 3 learning gap skills with estimated progress
  const topGrowthSkills = useMemo(() => {
    const skillMap = new Map<string, { totalGain: number; count: number }>();
    matches.forEach(m => {
      m.result?.learning_plan?.forEach(entry => {
        const existing = skillMap.get(entry.skill) ?? { totalGain: 0, count: 0 };
        existing.totalGain += entry.estimated_match_gain_pct;
        existing.count += 1;
        skillMap.set(entry.skill, existing);
      });
    });
    return Array.from(skillMap.entries())
      .map(([skill, data]) => ({
        skill,
        avgGain: Math.round(data.totalGain / data.count),
      }))
      .sort((a, b) => b.avgGain - a.avgGain)
      .slice(0, 3);
  }, [matches]);

  // Empty / no-candidate state
  if (!candidate) {
    return (
      <div className="flex flex-col items-center justify-center py-32 px-4 text-center">
        <div className="w-16 h-16 rounded-2xl bg-primary-container flex items-center justify-center mb-6">
          <Icon name="person_search" size="lg" className="text-primary" />
        </div>
        <h2 className="text-xl font-extrabold text-on-surface mb-2">No profile found</h2>
        <p className="text-sm text-on-surface-variant mb-6 max-w-sm">
          Upload your resume to create a profile and start matching with job descriptions.
        </p>
        <Link
          to="/upload"
          className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-primary to-secondary px-6 py-3 text-sm font-bold text-on-primary shadow-md hover:shadow-lg transition-shadow"
        >
          <Icon name="upload" size="sm" />
          Upload Resume
        </Link>
      </div>
    );
  }

  return (
    <div className="pb-8">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-extrabold tracking-tight text-on-surface">
          Welcome back, {candidate.name.split(' ')[0]}.
        </h1>
        <p className="text-sm text-on-surface-variant mt-1">
          Your career architecture at a glance.
        </p>
      </div>

      {/* Stats Row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <StatCard
          label="Active Matches"
          value={activeMatches}
          icon="work"
          trend={matches.length > 0 ? `${matches.length} total` : undefined}
        />
        <StatCard
          label="Skill Gaps"
          value={uniqueGapSkills.size}
          icon="trending_down"
          trend={verifiedGapCount > 0 ? `${verifiedGapCount} verified` : uniqueGapSkills.size > 0 ? 'Across all matches' : undefined}
        />
        <StatCard
          label="Verified Skills"
          value={verifiedSkills.length}
          icon="verified"
          trend={verifiedSkills.length > 0 ? `${verifiedGapCount} gaps closed` : 'Take assessments to verify'}
        />
        <StatCard
          label="Avg Score"
          value={avgScore > 0 ? `${avgScore}%` : '--'}
          icon="speed"
          trend={totalBoost > 0 ? `+${totalBoost}% from verified skills` : avgScore >= 70 ? 'Strong match' : avgScore > 0 ? 'Room to grow' : undefined}
        />
      </div>

      {/* Main grid: left 8 cols + right 4 cols */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left column: matches */}
        <div className="lg:col-span-8">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-extrabold text-on-surface">Top Matches</h2>
            {matches.length > 5 && (
              <button className="text-xs font-bold text-primary hover:text-primary/80 transition-colors">
                View All
              </button>
            )}
          </div>

          {/* Empty state */}
          {matches.length === 0 && !loading && (
            <div className="rounded-2xl bg-surface-container-low p-12 text-center">
              <div className="w-14 h-14 rounded-2xl bg-surface-container-high flex items-center justify-center mx-auto mb-4">
                <Icon name="work_outline" size="lg" className="text-on-surface-variant" />
              </div>
              <h3 className="font-bold text-on-surface mb-1">No matches yet</h3>
              <p className="text-sm text-on-surface-variant mb-4">
                Add job descriptions to get started.
              </p>
              <Link
                to="/upload?step=2"
                className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-primary to-secondary px-5 py-2.5 text-sm font-bold text-on-primary shadow-md hover:shadow-lg transition-shadow"
              >
                <Icon name="add" size="sm" />
                Add Job Descriptions
              </Link>
            </div>
          )}

          {/* Loading skeleton */}
          {loading && matches.length === 0 && (
            <div className="space-y-3">
              {[1, 2, 3].map(i => (
                <div key={i} className="rounded-xl bg-surface-container-low p-5 animate-pulse">
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 rounded-xl bg-surface-container-high" />
                    <div className="flex-1 space-y-2">
                      <div className="h-4 w-48 bg-surface-container-high rounded" />
                      <div className="h-3 w-24 bg-surface-container rounded" />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Match list */}
          <div className="space-y-3">
            {sortedMatches.map(match => (
              <div
                key={match.job_id}
                className="group rounded-xl bg-surface-container-low p-5 hover:bg-surface-container transition-colors"
              >
                <div className="flex items-center gap-4">
                  {/* Icon box */}
                  <div className="w-12 h-12 rounded-xl bg-primary-container flex items-center justify-center shrink-0">
                    <Icon
                      name={match.status === 'completed' ? 'work' : match.status === 'failed' ? 'error' : 'hourglass_top'}
                      size="md"
                      className="text-primary"
                    />
                  </div>

                  {/* Title + status */}
                  <div className="flex-1 min-w-0">
                    <p className="font-bold text-on-surface truncate">
                      {getMatchTitle(match)}
                    </p>
                    <div className="flex items-center gap-2 mt-1">
                      <StatusBadge status={match.status} match={match} />
                      {match.result?.confidence && (
                        <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-bold ${getConfidenceColor(match.result.confidence)}`}>
                          {match.result.confidence} confidence
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Score gauge or spinner */}
                  <div className="shrink-0 flex items-center gap-3">
                    {match.status === 'completed' && match.result ? (
                      <ScoreGauge score={Math.min(100, match.result.overall_score + getBoost(match))} size="sm" />
                    ) : (match.status === 'processing' || match.status === 'pending') ? (
                      <div className="w-12 h-12 flex items-center justify-center">
                        <span className="material-symbols-outlined text-2xl text-primary animate-spin">
                          progress_activity
                        </span>
                      </div>
                    ) : null}

                    {/* View button */}
                    {match.status === 'completed' && (
                      <Link
                        to={`/matches/${match.job_id}`}
                        className="hidden sm:inline-flex items-center gap-1.5 rounded-lg bg-surface-container-high px-3 py-2 text-xs font-bold text-on-surface hover:bg-primary hover:text-on-primary transition-colors"
                      >
                        View Analysis
                        <Icon name="arrow_forward" size="sm" />
                      </Link>
                    )}

                    {/* Delete button */}
                    <button
                      onClick={(e) => { e.stopPropagation(); handleDelete(match.job_id); }}
                      disabled={deleting === match.job_id}
                      className="opacity-0 group-hover:opacity-100 p-1.5 rounded-lg text-on-surface-variant hover:text-on-error-container hover:bg-error-container transition-all disabled:opacity-50"
                      title="Delete match"
                    >
                      <Icon name={deleting === match.job_id ? 'progress_activity' : 'delete'} size="sm"
                        className={deleting === match.job_id ? 'animate-spin' : ''} />
                    </button>
                  </div>
                </div>

                {/* Processing step progress */}
                {(match.status === 'processing' || match.status === 'pending') && (
                  <div className="mt-3">
                    <div className="flex gap-1.5">
                      {STEP_KEYS.map((tool) => {
                        const info = TOOL_STEP_INFO[tool];
                        const done = match.agent_trace?.tool_calls?.some(t => t.tool === tool && t.status === 'success');
                        const active = match.agent_trace?.tool_calls?.some(t => t.tool === tool && t.status !== 'success');
                        return (
                          <div key={tool} className="flex-1 flex flex-col items-center gap-1.5">
                            <div className={`h-1.5 w-full rounded-full transition-all duration-500 ${
                              done ? 'bg-tertiary-fixed shadow-[0_0_6px_rgba(111,251,190,0.4)]' : active ? 'bg-secondary animate-pulse' : 'bg-surface-container-high'
                            }`} />
                            <div className="flex items-center gap-1">
                              <span className={`material-symbols-outlined text-[11px] ${
                                done ? 'text-on-tertiary-container' : active ? 'text-secondary' : 'text-on-surface-variant/50'
                              }`}>{done ? 'check_circle' : info.icon}</span>
                              <span className={`text-[9px] font-bold ${
                                done ? 'text-on-tertiary-container' : active ? 'text-secondary' : 'text-on-surface-variant/50'
                              }`}>
                                {info.label}
                              </span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Mobile view button */}
                {match.status === 'completed' && (
                  <Link
                    to={`/matches/${match.job_id}`}
                    className="sm:hidden mt-3 flex items-center justify-center gap-1.5 rounded-lg bg-surface-container-high px-3 py-2 text-xs font-bold text-on-surface hover:bg-primary hover:text-on-primary transition-colors"
                  >
                    View Analysis
                    <Icon name="arrow_forward" size="sm" />
                  </Link>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Right column */}
        <div className="lg:col-span-4 space-y-6">
          {/* Profile Summary */}
          <div className="rounded-2xl bg-primary-container p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-11 h-11 rounded-full bg-primary flex items-center justify-center">
                <Icon name="person" size="md" className="text-on-primary" />
              </div>
              <div>
                <p className="font-bold text-on-primary">{candidate.name}</p>
                <p className="text-xs text-on-primary-container">{candidate.seniority_level}</p>
              </div>
            </div>

            <div className="space-y-3 mb-5">
              <div className="flex items-center gap-2 text-sm">
                <Icon name="calendar_month" size="sm" className="text-on-primary-container" />
                <span className="text-on-primary font-semibold">
                  {candidate.total_years_experience} years experience
                </span>
              </div>
              <div className="flex items-center gap-2 text-sm">
                <Icon name="mail" size="sm" className="text-on-primary-container" />
                <span className="text-on-primary font-semibold truncate">
                  {candidate.email}
                </span>
              </div>
            </div>

            {/* Skills as pills */}
            <div className="flex flex-wrap gap-1.5 mb-5">
              {candidate.skills.slice(0, 10).map(skill => (
                <span
                  key={skill}
                  className="rounded-full bg-white/15 px-2.5 py-1 text-xs font-semibold text-on-primary"
                >
                  {skill}
                </span>
              ))}
              {candidate.skills.length > 10 && (
                <span className="rounded-full bg-white/10 px-2.5 py-1 text-xs font-semibold text-on-primary-container">
                  +{candidate.skills.length - 10}
                </span>
              )}
            </div>

            <Link
              to="/upload"
              className="flex items-center justify-center gap-2 rounded-xl bg-white text-primary px-4 py-2.5 text-sm font-bold hover:bg-white/90 transition-colors"
            >
              <Icon name="edit" size="sm" />
              Update Profile
            </Link>
          </div>

          {/* Learning Progress */}
          {topGrowthSkills.length > 0 && (
            <div className="rounded-2xl bg-surface-container-low p-6">
              <h3 className="font-extrabold text-on-surface mb-4 flex items-center gap-2">
                <Icon name="school" size="sm" className="text-primary" />
                Learning Progress
              </h3>
              <div className="space-y-5">
                {topGrowthSkills.map(({ skill, avgGain }) => (
                  <GrowthBar
                    key={skill}
                    label={skill}
                    value={Math.min(avgGain, 100)}
                    sublabel={`Est. +${avgGain}% match improvement`}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Recent Activity Timeline */}
      {matches.length > 0 && (
        <div className="mt-8">
          <h2 className="text-lg font-extrabold text-on-surface mb-4">Recent Activity</h2>
          <div className="bg-surface-container-low rounded-2xl p-6">
            <div className="relative pl-6">
              {/* Vertical line */}
              <div className="absolute left-[7px] top-2 bottom-2 w-0.5 bg-surface-container-high" />
              <div className="space-y-6">
                {[...matches]
                  .sort((a, b) => {
                    const dateA = a.updated_at ?? a.created_at ?? '';
                    const dateB = b.updated_at ?? b.created_at ?? '';
                    return new Date(dateB).getTime() - new Date(dateA).getTime();
                  })
                  .slice(0, 5)
                  .map((m) => {
                    const dateStr = m.updated_at ?? m.created_at ?? '';
                    const timeAgo = (ds: string): string => {
                      if (!ds) return '';
                      const diff = Date.now() - new Date(ds).getTime();
                      const mins = Math.floor(diff / 60000);
                      if (mins < 1) return 'Just now';
                      if (mins < 60) return `${mins}m ago`;
                      const hours = Math.floor(mins / 60);
                      if (hours < 24) return `${hours}h ago`;
                      const days = Math.floor(hours / 24);
                      return `${days}d ago`;
                    };
                    const title = getMatchTitle(m);
                    const icon = m.status === 'completed' ? 'check_circle' : m.status === 'failed' ? 'error' : 'pending';
                    const iconColor = m.status === 'completed' ? 'text-on-tertiary-container' : m.status === 'failed' ? 'text-on-error-container' : 'text-secondary';
                    const label = m.status === 'completed'
                      ? `Matched with ${title} — Score: ${m.result?.overall_score ?? 0}%`
                      : m.status === 'failed'
                        ? `Analysis failed for ${title}`
                        : `Analysis started for ${title}`;
                    return (
                      <div key={m.job_id} className="relative flex items-start gap-3">
                        <div className={`absolute -left-6 top-0.5 w-3.5 h-3.5 rounded-full border-2 border-surface-container-low ${
                          m.status === 'completed' ? 'bg-tertiary-fixed' : m.status === 'failed' ? 'bg-error-container' : 'bg-secondary-fixed'
                        }`} />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className={`material-symbols-outlined text-base ${iconColor}`}>{icon}</span>
                            <p className="text-sm text-on-surface truncate">{label}</p>
                          </div>
                          {dateStr && (
                            <p className="text-xs text-on-surface-variant mt-0.5 ml-6">{timeAgo(dateStr)}</p>
                          )}
                        </div>
                      </div>
                    );
                  })}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Floating Add JD button */}
      <button
        type="button"
        onClick={() => navigate('/upload?step=2')}
        className="fixed bottom-8 right-8 flex items-center gap-2 rounded-2xl bg-gradient-to-r from-primary to-secondary px-5 py-3.5 text-sm font-bold text-on-primary shadow-lg hover:shadow-xl transition-shadow z-50"
      >
        <Icon name="add" size="md" />
        <span className="hidden sm:inline">Add Job Description</span>
      </button>
    </div>
  );
}
