import { useState, useRef, useCallback, useEffect, type DragEvent, type ChangeEvent } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { useCandidate } from '../context/CandidateContext';
import { uploadCandidate, submitMatches } from '../lib/api';
import type { CandidateResponse } from '../lib/api';
import Icon from '../components/shared/Icon';

interface JobEntry {
  id: string;
  type: 'text' | 'url';
  value: string;
}

export default function UploadPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { candidate, setCandidate, refreshMatches } = useCandidate();

  const paramStep = searchParams.get('step') === '2' ? 2 : 1;
  const [step, setStep] = useState(paramStep);

  // Sync step with URL query param when navigating between /upload and /upload?step=2
  useEffect(() => {
    setStep(paramStep);
  }, [paramStep]);

  // Step 1 state
  const [inputMode, setInputMode] = useState<'paste' | 'file'>('paste');
  const [resumeText, setResumeText] = useState('');
  const [resumeFile, setResumeFile] = useState<File | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [candidateData, setCandidateData] = useState<CandidateResponse | null>(candidate);

  // Step 2 state
  const [jobEntries, setJobEntries] = useState<JobEntry[]>([
    { id: crypto.randomUUID(), type: 'text', value: '' },
  ]);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // --- Step 1 handlers ---
  const handleDragOver = useCallback((e: DragEvent) => { e.preventDefault(); setIsDragging(true); }, []);
  const handleDragLeave = useCallback((e: DragEvent) => { e.preventDefault(); setIsDragging(false); }, []);
  const handleDrop = useCallback((e: DragEvent) => {
    e.preventDefault(); setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file && (file.type === 'application/pdf' || file.type === 'text/plain')) {
      setResumeFile(file); setInputMode('file'); setError(null);
    } else { setError('Please upload a PDF or TXT file.'); }
  }, []);
  const handleFileChange = useCallback((e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) { setResumeFile(file); setError(null); }
  }, []);

  const handleStep1Submit = async () => {
    setError(null);
    const formData = new FormData();
    if (inputMode === 'file') {
      if (!resumeFile) { setError('Please select a file.'); return; }
      formData.append('file', resumeFile);
    } else {
      if (!resumeText.trim()) { setError('Please paste your resume.'); return; }
      formData.append('resume_text', resumeText);
    }
    setLoading(true);
    try {
      const c = await uploadCandidate(formData);
      setCandidateData(c);
      setCandidate(c);
      setStep(2);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to process resume.');
    } finally { setLoading(false); }
  };

  // --- Step 2 handlers ---
  const addJobEntry = () => {
    if (jobEntries.length >= 10) return;
    setJobEntries(prev => [...prev, { id: crypto.randomUUID(), type: 'text', value: '' }]);
  };
  const removeJobEntry = (id: string) => {
    if (jobEntries.length <= 1) return;
    setJobEntries(prev => prev.filter(j => j.id !== id));
  };
  const updateJobEntry = (id: string, field: 'type' | 'value', val: string) => {
    setJobEntries(prev => prev.map(j => j.id === id ? { ...j, [field]: val } : j));
  };

  const handleStep2Submit = async () => {
    setError(null);
    const validEntries = jobEntries.filter(j => j.value.trim());
    if (validEntries.length === 0) { setError('Please add at least one job description.'); return; }

    const candidateId = candidateData?.candidate_id || candidate?.candidate_id;
    if (!candidateId) { setError('No candidate profile. Please upload your resume first.'); return; }

    const descriptions = validEntries.map(j => {
      try { new URL(j.value.trim()); return { url: j.value.trim() }; } catch { /* not url */ }
      return { text: j.value.trim() };
    });

    setLoading(true);
    try {
      await submitMatches(candidateId, descriptions);
      // Navigate immediately — dashboard will poll for results
      navigate('/');
      // Refresh in background (non-blocking)
      refreshMatches();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to submit job descriptions.');
      setLoading(false);
    }
  };

  const profilePreview = candidateData || candidate;

  return (
    <div>
      {/* Back nav */}
      <Link to="/" className="inline-flex items-center gap-1.5 text-sm font-bold text-on-surface-variant hover:text-secondary transition-colors mb-6">
        <Icon name="arrow_back" size="sm" />
        Back to Dashboard
      </Link>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        {/* Main content */}
        <div className="lg:col-span-8">
          {/* Step indicator */}
          <div className="flex items-center gap-4 mb-6">
            <div className="flex items-center gap-3 flex-1">
              <div className={`h-1.5 flex-1 rounded-full transition-colors ${step >= 1 ? 'bg-primary' : 'bg-surface-container-high'}`} />
              <div className={`h-1.5 flex-1 rounded-full transition-colors ${step >= 2 ? 'bg-primary' : 'bg-surface-container-high'}`} />
            </div>
            <span className="text-xs font-bold text-on-surface-variant uppercase tracking-wider">Step {step}/2</span>
          </div>

          {/* STEP 1 */}
          {step === 1 && (
            <div className="bg-surface-container-lowest rounded-2xl p-8">
              <h1 className="text-2xl font-extrabold text-on-surface tracking-tight mb-1">Upload Your Resume</h1>
              <p className="text-sm text-on-surface-variant mb-6">Paste text or upload a PDF/TXT file to update your profile.</p>

              <div className="flex gap-2 mb-6">
                {(['paste', 'file'] as const).map(mode => (
                  <button key={mode} onClick={() => setInputMode(mode)}
                    className={`px-4 py-2 rounded-lg text-sm font-bold transition-colors flex items-center gap-2 ${
                      inputMode === mode ? 'bg-primary text-on-primary' : 'bg-surface-container text-on-surface-variant hover:bg-surface-container-high'
                    }`}
                  >
                    <Icon name={mode === 'paste' ? 'content_paste' : 'upload_file'} size="sm" />
                    {mode === 'paste' ? 'Paste Text' : 'Upload File'}
                  </button>
                ))}
              </div>

              {inputMode === 'paste' ? (
                <textarea value={resumeText} onChange={e => setResumeText(e.target.value)}
                  placeholder="Paste your full resume content here..." rows={14}
                  className="w-full rounded-xl bg-surface-container-low p-4 text-sm text-on-surface placeholder:text-on-surface-variant/50 focus:outline-none focus:ring-2 focus:ring-primary/40 resize-none"
                />
              ) : (
                <div onDragOver={handleDragOver} onDragLeave={handleDragLeave} onDrop={handleDrop}
                  onClick={() => fileInputRef.current?.click()}
                  className={`flex flex-col items-center justify-center rounded-xl border-2 border-dashed p-12 cursor-pointer transition-colors ${
                    isDragging ? 'border-primary bg-primary/5' : 'border-outline-variant bg-surface-container-low hover:border-primary/40'
                  }`}
                >
                  <input ref={fileInputRef} type="file" accept=".pdf,.txt" onChange={handleFileChange} className="hidden" />
                  <Icon name="cloud_upload" size="lg" className="text-on-surface-variant mb-3" />
                  {resumeFile ? (
                    <><p className="font-bold text-on-surface">{resumeFile.name}</p><p className="text-xs text-on-surface-variant mt-1">{(resumeFile.size/1024).toFixed(1)} KB</p></>
                  ) : (
                    <><p className="font-bold text-on-surface">Drop your resume here</p><p className="text-xs text-on-surface-variant mt-1">PDF or TXT up to 10 MB</p></>
                  )}
                </div>
              )}

              {error && (
                <div className="mt-4 flex items-start gap-2 rounded-lg bg-error-container px-4 py-3">
                  <Icon name="error" size="sm" className="text-on-error-container mt-0.5" />
                  <p className="text-sm font-semibold text-on-error-container">{error}</p>
                </div>
              )}

              <button onClick={handleStep1Submit} disabled={loading}
                className="mt-6 w-full flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-primary to-secondary py-3.5 text-sm font-bold text-on-primary shadow-md hover:shadow-lg transition-shadow disabled:opacity-60"
              >
                {loading ? (<><span className="animate-spin inline-block"><Icon name="progress_activity" size="sm" /></span>Processing...</>)
                  : (<><Icon name="rocket_launch" size="sm" />Analyze Resume</>)}
              </button>
            </div>
          )}

          {/* STEP 2 */}
          {step === 2 && (
            <div className="bg-surface-container-lowest rounded-2xl p-8">
              <h1 className="text-2xl font-extrabold text-on-surface tracking-tight mb-1">Add Job Descriptions</h1>
              <p className="text-sm text-on-surface-variant mb-6">Add up to 10 job descriptions to match against your profile.</p>

              <div className="space-y-4">
                {jobEntries.map((entry, idx) => (
                  <div key={entry.id} className="rounded-xl bg-surface-container-low p-4">
                    <div className="flex items-center justify-between mb-3">
                      <span className="text-xs font-bold text-on-surface-variant uppercase tracking-wider">Job {idx + 1}</span>
                      {jobEntries.length > 1 && (
                        <button onClick={() => removeJobEntry(entry.id)}
                          className="rounded-md p-1 text-on-surface-variant hover:text-on-error-container hover:bg-error-container transition-colors">
                          <Icon name="close" size="sm" />
                        </button>
                      )}
                    </div>

                    {/* Input type toggle — clear two-tab style */}
                    <div className="flex gap-1 mb-3 bg-surface-container rounded-lg p-1">
                      <button onClick={() => updateJobEntry(entry.id, 'type', 'text')}
                        className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-md text-xs font-bold transition-all ${
                          entry.type === 'text' ? 'bg-surface-container-lowest text-on-surface shadow-sm' : 'text-on-surface-variant hover:text-on-surface'
                        }`}>
                        <Icon name="description" size="sm" />
                        Paste JD Text
                      </button>
                      <button onClick={() => updateJobEntry(entry.id, 'type', 'url')}
                        className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-md text-xs font-bold transition-all ${
                          entry.type === 'url' ? 'bg-surface-container-lowest text-on-surface shadow-sm' : 'text-on-surface-variant hover:text-on-surface'
                        }`}>
                        <Icon name="link" size="sm" />
                        Job Posting URL
                      </button>
                    </div>

                    {entry.type === 'text' ? (
                      <textarea value={entry.value}
                        onChange={e => {
                          const val = e.target.value;
                          updateJobEntry(entry.id, 'value', val);
                          // Auto-detect URL if user pastes a link
                          try { if (val.trim().startsWith('http') && new URL(val.trim())) updateJobEntry(entry.id, 'type', 'url'); } catch { /* not url */ }
                        }}
                        placeholder="Paste the full job description here..."
                        rows={5}
                        className="w-full rounded-lg bg-surface-container-lowest p-3 text-sm text-on-surface placeholder:text-on-surface-variant/50 focus:outline-none focus:ring-2 focus:ring-primary/40 resize-none"
                      />
                    ) : (
                      <div>
                        <input type="url" value={entry.value} onChange={e => updateJobEntry(entry.id, 'value', e.target.value)}
                          placeholder="https://example.com/job-posting"
                          className="w-full rounded-lg bg-surface-container-lowest px-3 py-2.5 text-sm text-on-surface placeholder:text-on-surface-variant/50 focus:outline-none focus:ring-2 focus:ring-primary/40"
                        />
                        {entry.value.trim() && (() => {
                          try {
                            const parsed = new URL(entry.value.trim());
                            return (
                              <div className="mt-2 flex items-center gap-2 rounded-lg bg-surface-container-lowest px-3 py-2 border border-outline-variant/30">
                                <span className="material-symbols-outlined text-base text-secondary">language</span>
                                <span className="text-xs font-semibold text-on-surface truncate">{parsed.hostname}</span>
                                <span className="ml-auto text-[10px] font-bold text-on-tertiary-container bg-tertiary-fixed/20 px-2 py-0.5 rounded-full">Job posting detected</span>
                              </div>
                            );
                          } catch {
                            return null;
                          }
                        })()}
                      </div>
                    )}
                  </div>
                ))}
              </div>

              {jobEntries.length < 10 && (
                <button onClick={addJobEntry} className="mt-4 flex items-center gap-2 text-sm font-bold text-primary hover:text-primary/80 transition-colors">
                  <Icon name="add_circle" size="sm" />
                  Add another ({jobEntries.length}/10)
                </button>
              )}

              {error && (
                <div className="mt-4 flex items-start gap-2 rounded-lg bg-error-container px-4 py-3">
                  <Icon name="error" size="sm" className="text-on-error-container mt-0.5" />
                  <p className="text-sm font-semibold text-on-error-container">{error}</p>
                </div>
              )}

              <div className="mt-6 flex gap-3">
                {paramStep !== 2 && (
                  <button onClick={() => { setStep(1); setError(null); }}
                    className="flex items-center gap-2 rounded-xl bg-surface-container-high px-5 py-3.5 text-sm font-bold text-on-surface-variant hover:bg-surface-container-highest transition-colors">
                    <Icon name="arrow_back" size="sm" /> Back
                  </button>
                )}
                <button onClick={handleStep2Submit} disabled={loading}
                  className="flex-1 flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-primary to-secondary py-3.5 text-sm font-bold text-on-primary shadow-md hover:shadow-lg transition-shadow disabled:opacity-60"
                >
                  {loading ? (<><span className="animate-spin inline-block"><Icon name="progress_activity" size="sm" /></span>Submitting...</>)
                    : (<><Icon name="bolt" size="sm" />Start Matching</>)}
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Right sidebar: Profile preview */}
        <div className="lg:col-span-4">
          {profilePreview && (
            <div className="bg-primary-container rounded-2xl p-6 sticky top-24">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-11 h-11 rounded-full bg-primary flex items-center justify-center">
                  <Icon name="person" size="md" className="text-on-primary" />
                </div>
                <div>
                  <p className="font-bold text-on-primary-container">{profilePreview.name}</p>
                  <p className="text-xs text-on-primary-container/70">{profilePreview.seniority_level} · {profilePreview.skills.length} skills</p>
                </div>
              </div>
              {profilePreview.summary && (
                <p className="text-xs text-on-primary-container/70 mb-4 leading-relaxed">{profilePreview.summary}</p>
              )}
              <div className="flex flex-wrap gap-1.5 mb-4">
                {profilePreview.skills.slice(0, 12).map(skill => (
                  <span key={skill} className="rounded-full bg-white/15 px-2.5 py-1 text-xs font-semibold text-on-primary-container">{skill}</span>
                ))}
                {profilePreview.skills.length > 12 && (
                  <span className="rounded-full bg-white/10 px-2.5 py-1 text-xs font-semibold text-on-primary-container/60">+{profilePreview.skills.length - 12}</span>
                )}
              </div>
              <Link to="/cv-editor"
                className="flex items-center justify-center gap-2 rounded-xl bg-tertiary-fixed text-on-tertiary-fixed px-4 py-2.5 text-sm font-bold hover:opacity-90 transition-opacity"
              >
                <Icon name="edit_document" size="sm" />
                Improve CV
              </Link>
            </div>
          )}

          {!profilePreview && step === 1 && (
            <div className="bg-surface-container-low rounded-2xl p-6">
              <h3 className="font-bold text-on-surface mb-2 flex items-center gap-2">
                <Icon name="info" size="sm" className="text-secondary" />
                How it works
              </h3>
              <ol className="text-sm text-on-surface-variant space-y-3">
                <li className="flex gap-3"><span className="w-6 h-6 rounded-full bg-primary text-on-primary flex items-center justify-center text-xs font-bold shrink-0">1</span>Upload your resume</li>
                <li className="flex gap-3"><span className="w-6 h-6 rounded-full bg-surface-container-high text-on-surface-variant flex items-center justify-center text-xs font-bold shrink-0">2</span>Add job descriptions</li>
                <li className="flex gap-3"><span className="w-6 h-6 rounded-full bg-surface-container-high text-on-surface-variant flex items-center justify-center text-xs font-bold shrink-0">3</span>Get AI-powered analysis</li>
              </ol>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
