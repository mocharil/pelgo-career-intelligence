import { useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useCandidate } from '../context/CandidateContext';
import type { MatchJob, MatchResult } from '../lib/api';
import Icon from '../components/shared/Icon';

function extractJobTitle(m: MatchJob): string {
  const jd = m.job_description_text;
  if (jd) {
    const lines = jd.split('\n').map(l => l.trim()).filter(l => l.length > 3);
    for (const line of lines.slice(0, 8)) {
      if (/^(about|requirements|responsibilities|nice to have|description|we are|join|apply|the role|overview|who we)/i.test(line)) continue;
      if (line.length >= 5 && line.length <= 60) return line;
      if (line.length > 60) return line.slice(0, 57) + '...';
    }
  }
  if (m.job_url) {
    try {
      const url = new URL(m.job_url);
      const pathParts = url.pathname.split('/').filter(Boolean);
      const lastPart = pathParts[pathParts.length - 1] || '';
      const cleaned = lastPart.replace(/[-_]\d+$/g, '').replace(/[-_]/g, ' ').trim();
      if (cleaned.length >= 4) {
        const host = url.hostname.replace('www.', '').split('.')[0];
        const title = cleaned.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
        return `${title} — ${host.charAt(0).toUpperCase() + host.slice(1)}`;
      }
    } catch { /* */ }
  }
  const reasoning = m.result?.reasoning || '';
  const domainMatch = reasoning.match(/[Dd]omain:\s*([^.]+)/);
  if (domainMatch) return domainMatch[1].trim().charAt(0).toUpperCase() + domainMatch[1].trim().slice(1) + ' Role';
  return 'Job Match';
}

function scoreColor(score: number): string {
  if (score > 70) return 'text-tertiary-fixed';
  if (score >= 50) return 'text-secondary';
  return 'text-on-error-container';
}

function scoreBg(score: number): string {
  if (score > 70) return 'bg-tertiary-container';
  if (score >= 50) return 'bg-secondary-fixed';
  return 'bg-error-container';
}

function confidenceBadgeClass(confidence: string): string {
  switch (confidence) {
    case 'high': return 'bg-tertiary-container text-tertiary-fixed';
    case 'medium': return 'bg-secondary-fixed text-secondary';
    default: return 'bg-error-container text-on-error-container';
  }
}

const COLUMN_COLORS = [
  'bg-primary/5',
  'bg-secondary/5',
  'bg-tertiary-container/30',
];

function generateSummary(selected: { title: string; result: MatchResult }[]): string {
  if (selected.length < 2) return '';

  const sorted = [...selected].sort((a, b) => b.result.overall_score - a.result.overall_score);
  const best = sorted[0];
  const rest = sorted.slice(1);

  let summary = `${best.title} scores highest overall (${best.result.overall_score}%) with `;
  const bestDims = best.result.dimension_scores;
  const strongDim = bestDims.skills >= bestDims.experience && bestDims.skills >= bestDims.seniority_fit
    ? 'skill alignment'
    : bestDims.experience >= bestDims.seniority_fit
      ? 'experience depth'
      : 'seniority fit';
  summary += `strong ${strongDim}. `;

  for (const other of rest) {
    const otherDims = other.result.dimension_scores;
    const otherStrong = otherDims.skills >= otherDims.experience && otherDims.skills >= otherDims.seniority_fit
      ? 'skill alignment'
      : otherDims.experience >= otherDims.seniority_fit
        ? 'experience depth'
        : 'seniority fit';

    const gapCount = other.result.gap_skills.length;
    summary += `${other.title} has ${otherStrong === strongDim ? 'comparable' : 'better'} ${otherStrong}`;
    summary += gapCount > 0
      ? ` but ${gapCount} skill gap${gapCount > 1 ? 's' : ''} to address (${other.result.overall_score}%). `
      : ` with no skill gaps (${other.result.overall_score}%). `;
  }

  summary += `Recommendation: pursue ${best.title} as your primary target.`;
  return summary;
}

function DimensionBarInline({ value, label }: { value: number; label: string }) {
  const barColor = value > 70 ? 'bg-tertiary-fixed' : value >= 50 ? 'bg-secondary' : 'bg-error';
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-xs">
        <span className="text-on-surface-variant">{label}</span>
        <span className="font-bold text-on-surface">{value}%</span>
      </div>
      <div className="h-2 bg-surface-container-high rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${barColor} transition-all`} style={{ width: `${value}%` }} />
      </div>
    </div>
  );
}

export default function ComparePage() {
  const { matches } = useCandidate();
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const completedMatches = useMemo(
    () => matches.filter((m): m is MatchJob & { result: MatchResult } => m.status === 'completed' && m.result !== null),
    [matches]
  );

  const toggleSelection = (jobId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(jobId)) {
        next.delete(jobId);
      } else if (next.size < 3) {
        next.add(jobId);
      }
      return next;
    });
  };

  const selected = useMemo(
    () => completedMatches.filter((m) => selectedIds.has(m.job_id)),
    [completedMatches, selectedIds]
  );

  // Compute shared vs unique skills
  const allMatchedSkills = useMemo(() => {
    const skillSets = selected.map((m) => new Set(m.result.matched_skills));
    const allSkills = new Set(selected.flatMap((m) => m.result.matched_skills));
    return Array.from(allSkills).map((skill) => ({
      skill,
      inAll: skillSets.every((s) => s.has(skill)),
      presentIn: skillSets.filter((s) => s.has(skill)).length,
    }));
  }, [selected]);

  const allGapSkills = useMemo(() => {
    const skillSets = selected.map((m) => new Set(m.result.gap_skills));
    const allSkills = new Set(selected.flatMap((m) => m.result.gap_skills));
    return Array.from(allSkills).map((skill) => ({
      skill,
      inAll: skillSets.every((s) => s.has(skill)),
      presentIn: skillSets.filter((s) => s.has(skill)).length,
    }));
  }, [selected]);

  const selectedTitles = useMemo(
    () => selected.map((m) => ({ title: extractJobTitle(m), result: m.result })),
    [selected]
  );

  const summary = useMemo(() => generateSummary(selectedTitles), [selectedTitles]);

  return (
    <div>
      {/* Back navigation */}
      <Link
        to="/"
        className="inline-flex items-center gap-1.5 text-sm font-bold text-on-surface-variant hover:text-secondary transition-colors mb-8"
      >
        <Icon name="arrow_back" size="sm" />
        Back to Dashboard
      </Link>

      {/* Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-extrabold text-primary">Compare Matches</h1>
        <p className="text-sm text-on-surface-variant mt-1">
          Select 2-3 completed matches to compare side by side
        </p>
      </div>

      {/* Empty state */}
      {completedMatches.length === 0 && (
        <div className="bg-surface-container-lowest rounded-xl p-12 text-center">
          <div className="w-16 h-16 bg-surface-container-high rounded-full flex items-center justify-center mx-auto mb-4">
            <Icon name="compare_arrows" size="lg" className="text-on-surface-variant" />
          </div>
          <h2 className="text-lg font-bold text-on-surface mb-2">No Completed Matches</h2>
          <p className="text-sm text-on-surface-variant max-w-md mx-auto">
            You need at least 2 completed job analyses to use the comparison feature. Head to the dashboard to start matching.
          </p>
          <Link
            to="/"
            className="inline-flex items-center gap-2 mt-6 px-6 py-3 bg-primary text-on-primary font-bold rounded-xl text-sm hover:opacity-90 transition-opacity"
          >
            <Icon name="arrow_back" size="sm" />
            Go to Dashboard
          </Link>
        </div>
      )}

      {/* Match Selector */}
      {completedMatches.length > 0 && (
        <div className="mb-8">
          <p className="text-xs font-bold text-on-surface-variant uppercase tracking-wider mb-3">
            Select matches to compare ({selectedIds.size}/3)
          </p>
          <div className="flex flex-wrap gap-3">
            {completedMatches.map((m) => {
              const isSelected = selectedIds.has(m.job_id);
              const title = extractJobTitle(m);
              const score = m.result.overall_score;
              return (
                <button
                  key={m.job_id}
                  onClick={() => toggleSelection(m.job_id)}
                  disabled={!isSelected && selectedIds.size >= 3}
                  className={`
                    flex items-center gap-3 px-4 py-3 rounded-xl border-2 text-left transition-all
                    ${isSelected
                      ? 'border-primary bg-primary/5'
                      : 'border-surface-container-high bg-surface-container-lowest hover:border-on-surface-variant'}
                    disabled:opacity-40 disabled:cursor-not-allowed
                  `}
                >
                  <div className={`w-5 h-5 rounded-md border-2 flex items-center justify-center shrink-0 transition-colors ${
                    isSelected ? 'border-primary bg-primary' : 'border-on-surface-variant'
                  }`}>
                    {isSelected && <Icon name="check" size="sm" className="text-on-primary text-xs" />}
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-bold text-on-surface truncate max-w-[200px]">{title}</p>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${scoreBg(score)} ${scoreColor(score)}`}>
                        {score}%
                      </span>
                      <span className="text-xs text-on-surface-variant">{m.result.confidence} confidence</span>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Comparison Table */}
      {selected.length >= 2 && (
        <div className="bg-surface-container-lowest rounded-xl overflow-hidden mb-8">
          {/* Column headers */}
          <div className="grid border-b border-surface-container-high" style={{ gridTemplateColumns: `200px repeat(${selected.length}, 1fr)` }}>
            <div className="px-6 py-4 bg-surface-container-low">
              <span className="text-xs font-bold text-on-surface-variant uppercase tracking-wider">Dimension</span>
            </div>
            {selected.map((m, i) => (
              <div key={m.job_id} className={`px-6 py-4 ${COLUMN_COLORS[i]} border-l border-surface-container-high`}>
                <p className="text-sm font-bold text-on-surface truncate">{extractJobTitle(m)}</p>
              </div>
            ))}
          </div>

          {/* Row 1: Overall Score */}
          <div className="grid border-b border-surface-container-high" style={{ gridTemplateColumns: `200px repeat(${selected.length}, 1fr)` }}>
            <div className="px-6 py-5 flex items-center">
              <span className="text-sm font-bold text-on-surface">Overall Score</span>
            </div>
            {selected.map((m, i) => (
              <div key={m.job_id} className={`px-6 py-5 border-l border-surface-container-high ${COLUMN_COLORS[i]} flex items-center gap-3`}>
                <span className={`text-3xl font-extrabold ${scoreColor(m.result.overall_score)}`}>
                  {m.result.overall_score}%
                </span>
              </div>
            ))}
          </div>

          {/* Row 2: Confidence */}
          <div className="grid border-b border-surface-container-high" style={{ gridTemplateColumns: `200px repeat(${selected.length}, 1fr)` }}>
            <div className="px-6 py-4 flex items-center">
              <span className="text-sm font-bold text-on-surface">Confidence</span>
            </div>
            {selected.map((m, i) => (
              <div key={m.job_id} className={`px-6 py-4 border-l border-surface-container-high ${COLUMN_COLORS[i]}`}>
                <span className={`inline-block px-3 py-1 text-[10px] font-bold rounded-full uppercase tracking-wider ${confidenceBadgeClass(m.result.confidence)}`}>
                  {m.result.confidence}
                </span>
              </div>
            ))}
          </div>

          {/* Row 3-5: Dimension Scores */}
          {(['skills', 'experience', 'seniority_fit'] as const).map((dim) => {
            const labels: Record<string, string> = { skills: 'Skills', experience: 'Experience', seniority_fit: 'Seniority Fit' };
            return (
              <div key={dim} className="grid border-b border-surface-container-high" style={{ gridTemplateColumns: `200px repeat(${selected.length}, 1fr)` }}>
                <div className="px-6 py-4 flex items-center">
                  <span className="text-sm font-bold text-on-surface">{labels[dim]}</span>
                </div>
                {selected.map((m, i) => (
                  <div key={m.job_id} className={`px-6 py-4 border-l border-surface-container-high ${COLUMN_COLORS[i]}`}>
                    <DimensionBarInline value={m.result.dimension_scores[dim]} label="" />
                  </div>
                ))}
              </div>
            );
          })}

          {/* Row 6: Matched Skills */}
          <div className="grid border-b border-surface-container-high" style={{ gridTemplateColumns: `200px repeat(${selected.length}, 1fr)` }}>
            <div className="px-6 py-4">
              <span className="text-sm font-bold text-on-surface">Matched Skills</span>
            </div>
            {selected.map((m, i) => {
              return (
                <div key={m.job_id} className={`px-6 py-4 border-l border-surface-container-high ${COLUMN_COLORS[i]}`}>
                  <div className="flex flex-wrap gap-1.5">
                    {m.result.matched_skills.map((skill) => {
                      const info = allMatchedSkills.find((s) => s.skill === skill);
                      const isShared = info?.inAll;
                      return (
                        <span
                          key={skill}
                          className={`inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-semibold ${
                            isShared
                              ? 'bg-tertiary-container text-tertiary-fixed'
                              : 'bg-surface-container-high text-on-surface-variant'
                          }`}
                        >
                          <span className="material-symbols-outlined text-xs" style={{ fontSize: '14px' }}>check</span>
                          {skill}
                        </span>
                      );
                    })}
                    {m.result.matched_skills.length === 0 && (
                      <span className="text-xs text-on-surface-variant">None</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Row 7: Gap Skills */}
          <div className="grid border-b border-surface-container-high" style={{ gridTemplateColumns: `200px repeat(${selected.length}, 1fr)` }}>
            <div className="px-6 py-4">
              <span className="text-sm font-bold text-on-surface">Gap Skills</span>
            </div>
            {selected.map((m, i) => {
              return (
                <div key={m.job_id} className={`px-6 py-4 border-l border-surface-container-high ${COLUMN_COLORS[i]}`}>
                  <div className="flex flex-wrap gap-1.5">
                    {m.result.gap_skills.map((skill) => {
                      const info = allGapSkills.find((s) => s.skill === skill);
                      const isShared = info?.inAll;
                      return (
                        <span
                          key={skill}
                          className={`inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-semibold ${
                            isShared
                              ? 'bg-error-container text-on-error-container'
                              : 'bg-surface-container-high text-on-surface-variant'
                          }`}
                        >
                          <span className="material-symbols-outlined text-xs" style={{ fontSize: '14px' }}>close</span>
                          {skill}
                        </span>
                      );
                    })}
                    {m.result.gap_skills.length === 0 && (
                      <span className="text-xs text-on-surface-variant">None</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Row 8: Learning Effort */}
          <div className="grid" style={{ gridTemplateColumns: `200px repeat(${selected.length}, 1fr)` }}>
            <div className="px-6 py-4 flex items-center">
              <span className="text-sm font-bold text-on-surface">Learning Effort</span>
            </div>
            {selected.map((m, i) => {
              const totalHours = m.result.learning_plan.reduce(
                (sum, entry) => sum + entry.resources.reduce((s, r) => s + r.estimated_hours, 0),
                0
              );
              return (
                <div key={m.job_id} className={`px-6 py-4 border-l border-surface-container-high ${COLUMN_COLORS[i]} flex items-center gap-2`}>
                  <Icon name="schedule" size="sm" className="text-on-surface-variant" />
                  <span className="text-lg font-extrabold text-on-surface">{totalHours}</span>
                  <span className="text-xs text-on-surface-variant">estimated hours</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* AI Summary */}
      {selected.length >= 2 && summary && (
        <div className="bg-surface-container-lowest rounded-xl p-6 mb-8">
          <div className="flex items-center gap-2 mb-4">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-primary to-secondary flex items-center justify-center">
              <Icon name="auto_awesome" size="sm" className="text-on-primary" />
            </div>
            <h3 className="font-bold text-on-surface text-sm uppercase tracking-wider">AI Comparison Summary</h3>
          </div>
          <p className="text-sm text-on-surface leading-relaxed">{summary}</p>
        </div>
      )}

      {/* Hint when only 1 selected */}
      {completedMatches.length >= 2 && selected.length === 1 && (
        <div className="bg-surface-container-lowest rounded-xl p-8 text-center">
          <Icon name="touch_app" size="lg" className="text-on-surface-variant mx-auto mb-3" />
          <p className="text-sm text-on-surface-variant">Select at least one more match to start comparing</p>
        </div>
      )}
    </div>
  );
}
