const API_BASE = '/api/v1';

export interface CandidateResponse {
  candidate_id: string;
  name: string;
  email: string;
  summary: string;
  skills: string[];
  seniority_level: string;
  total_years_experience: number;
  strengths: string[];
  experiences: { title: string; company: string; duration_years: number; description: string; skills_used: string[] }[];
  education: { degree: string; institution: string; field_of_study: string; year: number | null }[];
}

export interface MatchJob {
  job_id: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  result: MatchResult | null;
  error_detail: string | null;
  agent_trace: AgentTrace | null;
  job_description_text: string | null;
  job_url: string | null;
  created_at: string;
  updated_at: string | null;
}

export interface AgentTrace {
  tool_calls: { tool: string; status: string; latency_ms: number; error: string | null }[];
  total_llm_calls: number;
  fallbacks_triggered: number;
}

export interface MatchResult {
  job_id: string;
  overall_score: number;
  confidence: 'low' | 'medium' | 'high';
  dimension_scores: {
    skills: number;
    experience: number;
    seniority_fit: number;
  };
  matched_skills: string[];
  gap_skills: string[];
  reasoning: string;
  learning_plan: LearningPlanEntry[];
  agent_trace: AgentTrace;
}

export interface LearningPlanEntry {
  skill: string;
  priority_rank: number;
  estimated_match_gain_pct: number;
  resources: { title: string; url: string; estimated_hours: number; type: string }[];
  rationale: string;
}

export async function uploadCandidate(data: FormData): Promise<CandidateResponse> {
  const res = await fetch(`${API_BASE}/candidate`, { method: 'POST', body: data });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function submitMatches(
  candidateId: string,
  jobDescriptions: { text?: string; url?: string }[]
): Promise<{ jobs: { job_id: string; status: string }[] }> {
  const res = await fetch(`${API_BASE}/matches`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ candidate_id: candidateId, job_descriptions: jobDescriptions }),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function getMatch(jobId: string): Promise<MatchJob> {
  const res = await fetch(`${API_BASE}/matches/${jobId}`);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export interface MatchListResponse {
  jobs: MatchJob[];
  total: number;
  limit: number;
  offset: number;
}

export async function listMatches(
  candidateId: string,
  opts?: { status?: string; limit?: number; offset?: number }
): Promise<MatchListResponse> {
  const params = new URLSearchParams({ candidate_id: candidateId });
  if (opts?.status) params.set('status', opts.status);
  if (opts?.limit) params.set('limit', String(opts.limit));
  if (opts?.offset) params.set('offset', String(opts.offset));
  const res = await fetch(`${API_BASE}/matches?${params}`);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function improveCvText(
  selectedText: string,
  context: string,
  action: 'improve' | 'shorten' | 'expand' | 'quantify' = 'improve'
): Promise<{ improved_text: string; action: string }> {
  const res = await fetch(`${API_BASE}/cv/improve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ selected_text: selectedText, context, action }),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function generateCoverLetter(data: {
  candidate_name: string;
  candidate_summary: string;
  candidate_skills: string[];
  candidate_experiences: { title: string; company: string; duration_years: number; description: string }[];
  matched_skills: string[];
  gap_skills: string[];
  overall_score: number;
  job_description: string;
  reasoning: string;
}): Promise<{ cover_letter: string }> {
  const res = await fetch(`${API_BASE}/cover-letter`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function generateCvMarkdown(candidateId: string): Promise<{ markdown: string }> {
  const formData = new FormData();
  formData.append('candidate_id', candidateId);
  const res = await fetch(`${API_BASE}/cv/generate-markdown`, { method: 'POST', body: formData });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function updateCandidate(candidateId: string, resumeText: string): Promise<CandidateResponse> {
  const formData = new FormData();
  formData.append('resume_text', resumeText);
  const res = await fetch(`${API_BASE}/candidate/${candidateId}`, { method: 'PUT', body: formData });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function deleteMatch(jobId: string): Promise<void> {
  const res = await fetch(`${API_BASE}/matches/${jobId}`, { method: 'DELETE' });
  if (!res.ok) throw new Error(await res.text());
}

export interface CompanyProfile {
  company_name: string;
  industry: string;
  size_estimate: string;
  culture_signals: string[];
  pros: string[];
  cons: string[];
  summary: string;
}

export async function getCompanyProfile(jdText: string): Promise<CompanyProfile> {
  const formData = new FormData();
  formData.append('jd_text', jdText);
  const res = await fetch(`${API_BASE}/company-profile`, { method: 'POST', body: formData });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export interface QuizQuestion {
  id: number;
  question: string;
  options: string[];
  correct: string;
  explanation: string;
}

export interface QuizResult {
  skill: string;
  score: number;
  passed: boolean;
  feedback: string;
  results: { id: number; correct: boolean; your_answer: string; correct_answer: string; explanation: string }[];
}

export async function generateAssessment(skill: string, seniority: string): Promise<{ skill: string; questions: QuizQuestion[] }> {
  const res = await fetch(`${API_BASE}/assessment/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ skill, seniority }),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function gradeAssessment(
  skill: string, seniority: string, questions: QuizQuestion[], answers: { question_id: number; answer: string }[]
): Promise<QuizResult> {
  const res = await fetch(`${API_BASE}/assessment/grade`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ skill, seniority, questions, answers }),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function requeueMatch(jobId: string): Promise<{ job_id: string; status: string }> {
  const res = await fetch(`${API_BASE}/matches/${jobId}/requeue`, { method: 'POST' });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}
