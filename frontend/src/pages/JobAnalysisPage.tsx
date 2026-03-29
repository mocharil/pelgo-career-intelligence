import { useState, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useCandidate } from '../context/CandidateContext';
import { getMatch, generateCoverLetter, getCompanyProfile } from '../lib/api';
import { isSkillVerified, getSkillScore } from '../lib/skills';
import type { MatchJob, MatchResult, CandidateResponse, CompanyProfile } from '../lib/api';
import Icon from '../components/shared/Icon';
import ScoreGauge from '../components/shared/ScoreGauge';
import DimensionBar from '../components/shared/DimensionBar';
import RadarChart from '../components/shared/RadarChart';
import SkillChip from '../components/shared/SkillChip';
import InsightCard from '../components/shared/InsightCard';
import ExportReport from '../components/shared/ExportReport';

function extractJobTitle(match: MatchJob): string {
  const jdText = match.job_description_text;
  const reasoning = match.result?.reasoning || '';
  if (jdText) {
    const lines = jdText.split('\n').map(l => l.trim()).filter(l => l.length > 3);
    for (const line of lines.slice(0, 8)) {
      if (/^(about|requirements|responsibilities|nice to have|description|we are|join|apply|the role|overview|who we)/i.test(line)) continue;
      if (line.length >= 5 && line.length <= 70) return line;
      if (line.length > 70) return line.slice(0, 67) + '...';
    }
  }
  if (match.job_url) {
    try {
      const url = new URL(match.job_url);
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
  const domainMatch = reasoning.match(/[Dd]omain:\s*([^.]+)/);
  if (domainMatch) return domainMatch[1].trim().charAt(0).toUpperCase() + domainMatch[1].trim().slice(1) + ' Role';
  return 'Job Analysis';
}

function extractDomain(reasoning: string): string {
  const match = reasoning.match(/[Dd]omain:\s*([^.]+)/);
  return match ? match[1].trim() : '';
}

function SkeletonBlock({ className }: { className: string }) {
  return <div className={`animate-pulse bg-surface-container-high rounded-xl ${className}`} />;
}

function LoadingSkeleton() {
  return (
    <div className="space-y-8">
      <SkeletonBlock className="h-8 w-48" />
      <div className="flex justify-between items-start">
        <div className="space-y-3">
          <SkeletonBlock className="h-12 w-12" />
          <SkeletonBlock className="h-8 w-72" />
          <SkeletonBlock className="h-5 w-48" />
        </div>
        <SkeletonBlock className="h-48 w-48 rounded-full" />
      </div>
      <SkeletonBlock className="h-32 w-full" />
      <div className="grid grid-cols-2 gap-6">
        <SkeletonBlock className="h-48" />
        <SkeletonBlock className="h-48" />
      </div>
    </div>
  );
}

function ProcessingState({ match }: { match: MatchJob }) {
  const trace = match.agent_trace;
  return (
    <div className="flex flex-col items-center justify-center py-24 space-y-8">
      <div className="relative">
        <div className="w-20 h-20 rounded-full border-4 border-surface-container-high border-t-secondary animate-spin" />
        <Icon name="smart_toy" size="lg" className="absolute inset-0 m-auto text-secondary" />
      </div>
      <div className="text-center space-y-2">
        <h2 className="text-2xl font-extrabold text-primary">Agent is working...</h2>
        <p className="text-on-surface-variant text-sm">
          {match.status === 'pending' ? 'Queued and waiting for an available agent' : 'Analyzing your match in real-time'}
        </p>
      </div>
      {trace && trace.tool_calls.length > 0 && (
        <div className="w-full max-w-lg bg-surface-container-lowest rounded-xl p-6 space-y-3">
          <p className="text-xs font-bold text-on-surface-variant uppercase tracking-wider mb-4">Live Trace</p>
          {trace.tool_calls.map((call, i) => (
            <div key={i} className="flex items-center gap-3 text-sm">
              <Icon
                name={call.status === 'success' ? 'check_circle' : call.status === 'error' ? 'error' : 'pending'}
                size="sm"
                className={
                  call.status === 'success'
                    ? 'text-on-tertiary-container'
                    : call.status === 'error'
                      ? 'text-on-error-container'
                      : 'text-on-surface-variant'
                }
              />
              <span className="font-mono text-on-surface">{call.tool}</span>
              <span className="ml-auto text-xs text-on-surface-variant">{call.latency_ms}ms</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ErrorState({ detail, onRetry }: { detail: string; onRetry?: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center py-24 space-y-6">
      <div className="w-20 h-20 bg-error-container rounded-full flex items-center justify-center">
        <Icon name="error" size="lg" className="text-on-error-container" />
      </div>
      <div className="text-center space-y-2 max-w-md">
        <h2 className="text-2xl font-extrabold text-primary">Analysis Failed</h2>
        <p className="text-on-surface-variant text-sm leading-relaxed">{detail}</p>
      </div>
      {onRetry && (
        <button
          onClick={onRetry}
          className="px-6 py-3 bg-secondary text-on-primary font-bold rounded-xl text-sm hover:opacity-90 transition-opacity"
        >
          Retry Analysis
        </button>
      )}
    </div>
  );
}

function CoverLetterSection({ result, candidate, jobDescription, coverLetter, setCoverLetter }: {
  result: MatchResult; candidate: CandidateResponse; jobDescription: string;
  coverLetter: string | null; setCoverLetter: (v: string | null) => void;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [editing, setEditing] = useState(false);

  const handleGenerate = async () => {
    setLoading(true); setError(null);
    try {
      const res = await generateCoverLetter({
        candidate_name: candidate.name,
        candidate_summary: candidate.summary,
        candidate_skills: candidate.skills,
        candidate_experiences: candidate.experiences,
        matched_skills: result.matched_skills,
        gap_skills: result.gap_skills,
        overall_score: result.overall_score,
        job_description: jobDescription,
        reasoning: result.reasoning,
      });
      setCoverLetter(res.cover_letter);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate cover letter.');
    } finally { setLoading(false); }
  };

  const handleCopy = async () => {
    if (!coverLetter) return;
    await navigator.clipboard.writeText(coverLetter);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (!coverLetter) {
    return (
      <div className="bg-surface-container-lowest rounded-xl p-8 text-center">
        <div className="w-14 h-14 rounded-2xl bg-secondary-fixed flex items-center justify-center mx-auto mb-4">
          <Icon name="mail" size="lg" className="text-secondary" />
        </div>
        <h3 className="text-lg font-extrabold text-on-surface mb-2">Ready to Apply?</h3>
        <p className="text-sm text-on-surface-variant mb-6 max-w-md mx-auto">
          Generate a tailored cover letter based on your profile and this job match. Copy it and send directly with your application.
        </p>
        {error && (
          <div className="mb-4 flex items-start gap-2 rounded-lg bg-error-container px-4 py-3 text-left max-w-md mx-auto">
            <Icon name="error" size="sm" className="text-on-error-container mt-0.5" />
            <p className="text-sm font-semibold text-on-error-container">{error}</p>
          </div>
        )}
        <button onClick={handleGenerate} disabled={loading}
          className="inline-flex items-center gap-2 px-8 py-3.5 bg-gradient-to-r from-secondary to-primary text-on-primary font-bold rounded-xl text-sm hover:opacity-90 transition-opacity disabled:opacity-60"
        >
          {loading ? (
            <><span className="animate-spin inline-block"><Icon name="progress_activity" size="sm" /></span>Generating...</>
          ) : (
            <><Icon name="auto_awesome" size="sm" />Generate Cover Letter</>
          )}
        </button>
      </div>
    );
  }

  return (
    <div className="bg-surface-container-lowest rounded-xl overflow-hidden">
      <div className="flex items-center justify-between px-6 py-4 bg-surface-container-low">
        <div className="flex items-center gap-2">
          <Icon name="mail" size="sm" className="text-secondary" />
          <h3 className="font-bold text-on-surface text-sm uppercase tracking-wider">Cover Letter</h3>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setEditing(!editing)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-colors ${
              editing ? 'bg-tertiary-fixed text-on-tertiary-fixed' : 'bg-surface-container-high text-on-surface-variant hover:bg-surface-container-highest'
            }`}
          >
            <Icon name={editing ? 'check' : 'edit'} size="sm" />
            {editing ? 'Done Editing' : 'Edit'}
          </button>
          <button onClick={handleGenerate} disabled={loading}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-surface-container-high text-on-surface-variant text-xs font-bold hover:bg-surface-container-highest transition-colors disabled:opacity-60"
          >
            <Icon name="refresh" size="sm" />
            {loading ? 'Regenerating...' : 'Regenerate'}
          </button>
          <button onClick={handleCopy}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary text-on-primary text-xs font-bold hover:opacity-90 transition-opacity"
          >
            <Icon name={copied ? 'check' : 'content_copy'} size="sm" />
            {copied ? 'Copied!' : 'Copy'}
          </button>
        </div>
      </div>
      <div className="px-8 py-6">
        {editing ? (
          <textarea
            value={coverLetter || ''}
            onChange={e => setCoverLetter(e.target.value)}
            rows={15}
            className="w-full rounded-xl bg-surface-container-low p-4 text-sm text-on-surface focus:outline-none focus:ring-2 focus:ring-primary/40 resize-none leading-relaxed"
          />
        ) : (
          <p className="text-sm text-on-surface leading-relaxed whitespace-pre-wrap">{coverLetter}</p>
        )}
      </div>
    </div>
  );
}

function OriginalJdSection({ jdText, jdUrl }: { jdText: string | null; jdUrl: string | null }) {
  const [expanded, setExpanded] = useState(false);
  const content = jdText || null;
  if (!content && !jdUrl) return null;

  return (
    <div className="bg-surface-container-lowest rounded-xl overflow-hidden">
      <button onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-6 py-4 hover:bg-surface-container-low transition-colors text-left"
      >
        <div className="flex items-center gap-2">
          <Icon name="description" size="sm" className="text-on-surface-variant" />
          <h3 className="font-bold text-on-surface text-sm uppercase tracking-wider">Original Job Description</h3>
          {jdUrl && (
            <span className="text-[10px] font-mono text-secondary bg-secondary-fixed px-2 py-0.5 rounded-full">URL</span>
          )}
        </div>
        <Icon name={expanded ? 'expand_less' : 'expand_more'} size="sm" className="text-on-surface-variant" />
      </button>
      {expanded && (
        <div className="px-6 pb-5">
          {jdUrl && (
            <a href={jdUrl} target="_blank" rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-xs font-bold text-secondary hover:underline mb-3"
            >
              <Icon name="open_in_new" size="sm" />{jdUrl.length > 60 ? jdUrl.slice(0, 57) + '...' : jdUrl}
            </a>
          )}
          {content && (
            <pre className="text-sm text-on-surface-variant leading-relaxed whitespace-pre-wrap font-sans bg-surface-container-low rounded-xl p-4 max-h-80 overflow-auto">
              {content}
            </pre>
          )}
          {!content && jdUrl && (
            <p className="text-sm text-on-surface-variant italic">Job description was fetched from the URL above and parsed by the AI agent.</p>
          )}
        </div>
      )}
    </div>
  );
}

function CompanyLogo({ name, size = 40 }: { name: string; size?: number }) {
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!name || name === 'Unknown') { setFailed(true); return; }
    // Try Clearbit first (higher quality), fallback to Google Favicon
    const domain = name.toLowerCase().replace(/[^a-z0-9]/g, '') + '.com';
    setSrc(`https://logo.clearbit.com/${domain}`);
    setFailed(false);
  }, [name]);

  if (failed || !src) {
    return (
      <div className="rounded-xl bg-primary-fixed flex items-center justify-center shrink-0" style={{ width: size, height: size }}>
        <span className="text-primary font-extrabold" style={{ fontSize: size * 0.4 }}>{name.charAt(0)}</span>
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={name}
      className="rounded-xl bg-surface-container object-contain shrink-0"
      style={{ width: size, height: size }}
      onError={() => {
        // Fallback to Google Favicon
        if (src.includes('clearbit')) {
          const domain = name.toLowerCase().replace(/[^a-z0-9]/g, '') + '.com';
          setSrc(`https://www.google.com/s2/favicons?domain=${domain}&sz=${size}`);
        } else {
          setFailed(true);
        }
      }}
    />
  );
}

function CompanyProfileSection({ jobDescription, jobUrl }: { jobDescription: string; jobUrl: string | null }) {
  const [profile, setProfile] = useState<CompanyProfile | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleLoad = async () => {
    setLoading(true); setError(null);
    try {
      const data = await getCompanyProfile(jobDescription);
      setProfile(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load company profile.');
    } finally { setLoading(false); }
  };

  // Try to extract domain from job URL for logo
  const urlDomain = jobUrl ? (() => { try { return new URL(jobUrl).hostname.replace('www.', ''); } catch { return null; } })() : null;

  if (!profile) {
    return (
      <div className="bg-surface-container-lowest rounded-xl p-6 flex items-center justify-between">
        <div className="flex items-center gap-4">
          {urlDomain ? (
            <img src={`https://www.google.com/s2/favicons?domain=${urlDomain}&sz=48`}
              alt="" className="w-12 h-12 rounded-xl bg-surface-container object-contain"
              onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }} />
          ) : (
            <div className="w-12 h-12 rounded-xl bg-secondary-fixed flex items-center justify-center">
              <Icon name="domain" size="md" className="text-secondary" />
            </div>
          )}
          <div>
            <h3 className="font-bold text-on-surface">Company Insights</h3>
            <p className="text-xs text-on-surface-variant">Analyze company culture, size, and fit from the job description</p>
          </div>
        </div>
        <button onClick={handleLoad} disabled={loading}
          className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-secondary text-on-secondary text-xs font-bold hover:opacity-90 transition-opacity disabled:opacity-50 shrink-0"
        >
          {loading ? (
            <><span className="animate-spin"><Icon name="progress_activity" size="sm" /></span>Analyzing...</>
          ) : (
            <><Icon name="search" size="sm" />Analyze Company</>
          )}
        </button>
        {error && <p className="text-xs text-error mt-2">{error}</p>}
      </div>
    );
  }

  return (
    <div className="bg-surface-container-lowest rounded-xl overflow-hidden">
      <div className="flex items-center gap-3 px-6 py-4 bg-surface-container-low">
        <Icon name="domain" size="sm" className="text-secondary" />
        <h3 className="font-bold text-on-surface text-sm uppercase tracking-wider">Company Profile</h3>
      </div>
      <div className="p-6 space-y-5">
        {/* Header */}
        <div className="flex items-start gap-4">
          <CompanyLogo name={profile.company_name} size={48} />
          <div>
            <h4 className="text-xl font-extrabold text-on-surface">{profile.company_name}</h4>
            <p className="text-sm text-on-surface-variant">{profile.industry} · {profile.size_estimate}</p>
          </div>
        </div>

        {/* Summary */}
        <p className="text-sm text-on-surface-variant leading-relaxed">{profile.summary}</p>

        {/* Culture signals */}
        <div>
          <p className="text-xs font-bold text-on-surface-variant uppercase tracking-wider mb-2">Culture Signals</p>
          <div className="flex flex-wrap gap-2">
            {profile.culture_signals.map(s => (
              <span key={s} className="inline-flex items-center gap-1 px-3 py-1.5 rounded-full bg-secondary-fixed text-on-secondary-fixed text-xs font-bold">
                <Icon name="label" size="sm" />{s}
              </span>
            ))}
          </div>
        </div>

        {/* Pros & Cons */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="bg-tertiary-fixed/10 rounded-xl p-4">
            <p className="text-xs font-bold text-on-tertiary-container uppercase tracking-wider mb-2 flex items-center gap-1">
              <Icon name="thumb_up" size="sm" />Potential Pros
            </p>
            <ul className="space-y-1.5">
              {profile.pros.map(p => (
                <li key={p} className="text-sm text-on-surface-variant flex items-start gap-2">
                  <Icon name="check" size="sm" className="text-on-tertiary-container mt-0.5 shrink-0" />{p}
                </li>
              ))}
            </ul>
          </div>
          <div className="bg-error-container/30 rounded-xl p-4">
            <p className="text-xs font-bold text-on-error-container uppercase tracking-wider mb-2 flex items-center gap-1">
              <Icon name="help" size="sm" />Things to Verify
            </p>
            <ul className="space-y-1.5">
              {profile.cons.map(c => (
                <li key={c} className="text-sm text-on-surface-variant flex items-start gap-2">
                  <Icon name="arrow_forward" size="sm" className="text-on-error-container mt-0.5 shrink-0" />{c}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}

function CompletedAnalysis({ result, jobId, candidate, jobDescription, match }: {
  result: MatchResult; jobId: string; candidate: CandidateResponse | null; jobDescription: string; match: MatchJob;
}) {
  const title = extractJobTitle(match);
  const domain = extractDomain(result.reasoning);
  const [coverLetter, setCoverLetter] = useState<string | null>(null);

  // Calculate verified skill boost
  const boost = result.learning_plan
    .filter(entry => isSkillVerified(entry.skill))
    .reduce((sum, entry) => sum + entry.estimated_match_gain_pct, 0);
  const boostedScore = Math.min(100, result.overall_score + boost);

  // Boosted dimension scores (verified skills primarily boost Skills dimension)
  const verifiedCount = result.gap_skills.filter(s => isSkillVerified(s)).length;
  const totalGaps = result.gap_skills.length;
  const skillsBoost = totalGaps > 0 ? Math.round((verifiedCount / totalGaps) * (100 - result.dimension_scores.skills)) : 0;
  const boostedDimensions = {
    skills: Math.min(100, result.dimension_scores.skills + skillsBoost),
    experience: result.dimension_scores.experience, // unchanged — can't verify experience
    seniority_fit: result.dimension_scores.seniority_fit, // unchanged
  };

  const confidenceColors = {
    high: 'bg-tertiary-container text-tertiary-fixed',
    medium: 'bg-secondary-fixed text-secondary',
    low: 'bg-error-container text-on-error-container',
  };

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex flex-col lg:flex-row justify-between items-start gap-6">
        <div className="flex items-start gap-4">
          <div className="w-12 h-12 bg-surface-container-high rounded-xl flex items-center justify-center shrink-0">
            <Icon name="apartment" className="text-on-surface-variant" />
          </div>
          <div>
            <h1 className="text-3xl font-extrabold text-primary leading-tight">{title}</h1>
            {domain && (
              <p className="text-sm text-on-surface-variant mt-1 flex items-center gap-1.5">
                <Icon name="location_on" size="sm" />
                {domain}
              </p>
            )}
            <span
              className={`inline-block mt-3 px-3 py-1 text-[10px] font-bold rounded-full uppercase tracking-wider ${confidenceColors[result.confidence]}`}
            >
              {result.confidence} confidence
            </span>
          </div>
        </div>
        <div className="text-center">
          <ScoreGauge score={boostedScore} size="lg" label="MATCH" />
          {boost > 0 && (
            <p className="text-xs font-bold text-on-tertiary-container mt-2 flex items-center justify-center gap-1">
              <Icon name="trending_up" size="sm" />
              +{boost}% from verified skills (was {result.overall_score}%)
            </p>
          )}
        </div>
      </div>

      {/* Main grid: content + sidebar */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        {/* Left content: 8 cols */}
        <div className="lg:col-span-8 space-y-8">
          {/* AI Reasoning */}
          <InsightCard title="AI Analysis">
            {result.reasoning}
          </InsightCard>

          {/* Original JD */}
          <OriginalJdSection jdText={match.job_description_text} jdUrl={match.job_url} />

          {/* Skills Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="bg-surface-container-lowest rounded-xl p-6">
              <div className="flex items-center gap-2 mb-4">
                <Icon name="verified" size="sm" className="text-on-tertiary-container" />
                <h3 className="font-bold text-on-surface text-sm uppercase tracking-wider">Matched Core Skills</h3>
              </div>
              <div className="flex flex-wrap gap-2">
                {result.matched_skills.length > 0 ? (
                  result.matched_skills.map((skill) => (
                    <SkillChip key={skill} skill={skill} variant="matched" />
                  ))
                ) : (
                  <p className="text-sm text-on-surface-variant">No matched skills identified.</p>
                )}
              </div>
            </div>

            <div className="bg-surface-container-lowest rounded-xl p-6">
              <div className="flex items-center gap-2 mb-4">
                <Icon name="trending_up" size="sm" className="text-on-error-container" />
                <h3 className="font-bold text-on-surface text-sm uppercase tracking-wider">Competency Gaps</h3>
              </div>
              <div className="flex flex-wrap gap-2">
                {result.gap_skills.length > 0 ? (
                  result.gap_skills.map((skill) => {
                    const verified = isSkillVerified(skill);
                    const score = getSkillScore(skill);
                    return verified ? (
                      <span key={skill} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-bold bg-tertiary-fixed/20 text-on-tertiary-container">
                        <Icon name="verified" size="sm" filled />{skill}
                        <span className="text-[10px] ml-1 opacity-70">{score}%</span>
                      </span>
                    ) : (
                      <SkillChip key={skill} skill={skill} variant="gap" />
                    );
                  })
                ) : (
                  <p className="text-sm text-on-surface-variant">No competency gaps identified.</p>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Right sidebar: 4 cols */}
        <div className="lg:col-span-4 space-y-6">
          {/* Dimension Breakdown */}
          <div className="bg-surface-container-lowest rounded-xl p-6">
            <h3 className="font-bold text-on-surface text-sm uppercase tracking-wider mb-6">
              Dimension Breakdown
            </h3>
            <RadarChart dimensions={[
              { label: 'Skills', value: boostedDimensions.skills },
              { label: 'Experience', value: boostedDimensions.experience },
              { label: 'Seniority', value: boostedDimensions.seniority_fit },
            ]} />
            <div className="space-y-5 mt-6">
              <DimensionBar
                label="Skills"
                value={boostedDimensions.skills}
                description={skillsBoost > 0 ? `+${skillsBoost}% from ${verifiedCount} verified skill${verifiedCount > 1 ? 's' : ''} (was ${result.dimension_scores.skills}%)` : 'Technical and soft skill alignment'}
              />
              <DimensionBar
                label="Experience"
                value={boostedDimensions.experience}
                description="Relevant work history depth"
              />
              <DimensionBar
                label="Seniority Fit"
                value={boostedDimensions.seniority_fit}
                description="Level and responsibility match"
              />
            </div>
          </div>

          {/* Market Insight */}
          <div className="bg-surface-container-lowest rounded-xl p-6">
            <div className="flex items-center gap-2 mb-3">
              <Icon name="analytics" size="sm" className="text-secondary" />
              <h3 className="font-bold text-on-surface text-sm uppercase tracking-wider">Market Insight</h3>
            </div>
            <p className="text-sm text-on-surface-variant leading-relaxed">
              {domain
                ? `This role is in the ${domain} space. Your score of ${result.overall_score}% positions you competitively among candidates in this domain.`
                : `Your overall match score of ${result.overall_score}% reflects a comprehensive evaluation across skills, experience, and seniority dimensions.`}
            </p>
          </div>
        </div>
      </div>

      {/* Company Profile */}
      <CompanyProfileSection jobDescription={jobDescription} jobUrl={match.job_url} />

      {/* Cover Letter Generator */}
      {candidate && (
        <CoverLetterSection result={result} candidate={candidate} jobDescription={jobDescription} coverLetter={coverLetter} setCoverLetter={setCoverLetter} />
      )}

      {/* Bottom CTAs */}
      <div className="flex flex-col sm:flex-row gap-4 pt-4">
        <Link
          to={`/matches/${jobId}/learn`}
          className="flex-1 flex items-center justify-center gap-2 px-8 py-4 bg-gradient-to-r from-primary to-secondary text-on-primary font-bold rounded-xl text-sm hover:opacity-90 transition-opacity"
        >
          <Icon name="school" size="sm" />
          View Learning Plan
        </Link>
        <Link
          to={`/matches/${jobId}/trace`}
          className="flex-1 flex items-center justify-center gap-2 px-8 py-4 bg-surface-container-high text-on-surface font-bold rounded-xl text-sm hover:bg-surface-container-highest transition-colors"
        >
          <Icon name="timeline" size="sm" />
          View Agent Trace
        </Link>
        {candidate && (
          <ExportReport candidate={candidate} match={match} coverLetter={coverLetter || undefined} />
        )}
      </div>
    </div>
  );
}

export default function JobAnalysisPage() {
  const { jobId } = useParams<{ jobId: string }>();
  const navigate = useNavigate();
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

  // Poll for pending/processing matches
  useEffect(() => {
    if (!match || !jobId) return;
    if (match.status !== 'pending' && match.status !== 'processing') return;

    const interval = setInterval(async () => {
      try {
        const updated = await getMatch(jobId);
        setMatch(updated);
        if (updated.status === 'completed' || updated.status === 'failed') {
          clearInterval(interval);
        }
      } catch {
        // Silently retry on next interval
      }
    }, 3000);

    return () => clearInterval(interval);
  }, [match?.status, jobId]);

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

      {/* Content */}
      {loading && <LoadingSkeleton />}

      {!loading && error && (
        <ErrorState detail={error} onRetry={() => navigate(0)} />
      )}

      {!loading && !error && match && (match.status === 'pending' || match.status === 'processing') && (
        <ProcessingState match={match} />
      )}

      {!loading && !error && match && match.status === 'failed' && (
        <ErrorState
          detail={match.error_detail || 'The analysis agent encountered an unexpected error.'}
          onRetry={() => navigate(0)}
        />
      )}

      {!loading && !error && match && match.status === 'completed' && match.result && jobId && (
        <CompletedAnalysis
          result={match.result}
          jobId={jobId}
          candidate={candidate}
          jobDescription={match.job_description_text || match.result.reasoning}
          match={match}
        />
      )}

      {!loading && !error && !match && (
        <ErrorState detail="Match not found. It may have been removed or the link is invalid." />
      )}
    </div>
  );
}
