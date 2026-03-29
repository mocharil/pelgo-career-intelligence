import { useState, useRef, useEffect, type DragEvent, type ChangeEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useCandidate } from '../context/CandidateContext';
import { uploadCandidate } from '../lib/api';
import Icon from '../components/shared/Icon';

export default function OnboardingPage() {
  const navigate = useNavigate();
  const { candidate, setCandidate } = useCandidate();
  const [inputMode, setInputMode] = useState<'paste' | 'file'>('paste');
  const [resumeText, setResumeText] = useState('');
  const [resumeFile, setResumeFile] = useState<File | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (candidate) navigate('/', { replace: true });
  }, [candidate, navigate]);

  const handleDragOver = (e: DragEvent) => { e.preventDefault(); setIsDragging(true); };
  const handleDragLeave = (e: DragEvent) => { e.preventDefault(); setIsDragging(false); };
  const handleDrop = (e: DragEvent) => {
    e.preventDefault(); setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file && (file.type === 'application/pdf' || file.type === 'text/plain')) {
      setResumeFile(file); setInputMode('file'); setError(null);
    } else { setError('Please upload a PDF or TXT file.'); }
  };
  const handleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) { setResumeFile(file); setError(null); }
  };

  const handleSubmit = async () => {
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
      setCandidate(c);
      navigate('/');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to process resume.');
    } finally { setLoading(false); }
  };

  if (candidate) return null;

  return (
    <div className="min-h-screen bg-surface flex flex-col">
      {/* Nav */}
      <header className="flex items-center justify-between px-8 lg:px-12 py-5 shrink-0">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center">
            <span className="text-on-primary font-extrabold text-sm">P</span>
          </div>
          <span className="text-xl font-extrabold tracking-tighter text-primary">Pelgo</span>
        </div>
        <span className="hidden sm:flex items-center gap-1.5 text-xs text-on-surface-variant">
          <span className="material-symbols-outlined text-sm text-tertiary-fixed-dim">verified</span>
          Powered by Gemini + LangGraph
        </span>
      </header>

      {/* Main */}
      <main className="flex-1 flex items-center justify-center px-6 lg:px-12 py-8">
        <div className="w-full max-w-5xl">

          {/* Hero text — centered */}
          <div className="text-center mb-10">
            <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-primary/5 mb-5">
              <span className="w-1.5 h-1.5 rounded-full bg-tertiary-fixed animate-pulse" />
              <span className="text-[11px] font-bold text-primary/60 tracking-widest uppercase">AI-First Career Intelligence</span>
            </div>
            <h1 className="text-4xl lg:text-5xl font-extrabold text-on-surface leading-[1.15] tracking-tight mb-4">
              Upload your resume,<br />
              <span className="text-primary">we architect the rest.</span>
            </h1>
            <p className="text-on-surface-variant text-base max-w-lg mx-auto">
              AI-powered skill analysis, job matching, learning paths, and cover letters — all from a single upload.
            </p>
          </div>

          {/* Form card */}
          <div className="bg-surface-container-lowest rounded-2xl shadow-sm overflow-hidden max-w-2xl mx-auto">
            {/* Toggle header */}
            <div className="flex border-b border-surface-container-high">
              {(['paste', 'file'] as const).map(mode => (
                <button key={mode} onClick={() => setInputMode(mode)}
                  className={`flex-1 flex items-center justify-center gap-2 px-6 py-4 text-sm font-bold transition-colors relative ${
                    inputMode === mode
                      ? 'text-primary'
                      : 'text-on-surface-variant hover:text-on-surface'
                  }`}
                >
                  <Icon name={mode === 'paste' ? 'content_paste' : 'upload_file'} size="sm" />
                  {mode === 'paste' ? 'Paste Resume Text' : 'Upload PDF / TXT File'}
                  {inputMode === mode && (
                    <span className="absolute bottom-0 left-4 right-4 h-[3px] bg-primary rounded-t-full" />
                  )}
                </button>
              ))}
            </div>

            {/* Input area */}
            <div className="p-6">
              {inputMode === 'paste' ? (
                <textarea value={resumeText} onChange={e => setResumeText(e.target.value)}
                  placeholder="Paste your full resume content here — include your experience, skills, education..."
                  rows={12}
                  className="w-full rounded-xl bg-surface-container-low p-5 text-sm text-on-surface placeholder:text-on-surface-variant/40 focus:outline-none focus:ring-2 focus:ring-primary/30 resize-none leading-relaxed"
                />
              ) : (
                <div onDragOver={handleDragOver} onDragLeave={handleDragLeave} onDrop={handleDrop}
                  onClick={() => fileInputRef.current?.click()}
                  className={`flex flex-col items-center justify-center rounded-xl border-2 border-dashed py-16 cursor-pointer transition-all ${
                    isDragging
                      ? 'border-primary bg-primary/5 scale-[1.01]'
                      : resumeFile
                        ? 'border-tertiary-fixed-dim bg-tertiary-fixed/5'
                        : 'border-outline-variant bg-surface-container-low hover:border-primary/40 hover:bg-surface-container'
                  }`}
                >
                  <input ref={fileInputRef} type="file" accept=".pdf,.txt" onChange={handleFileChange} className="hidden" />
                  <div className={`w-16 h-16 rounded-2xl flex items-center justify-center mb-4 ${
                    resumeFile ? 'bg-tertiary-fixed/15' : 'bg-surface-container'
                  }`}>
                    <Icon name={resumeFile ? 'task' : 'cloud_upload'} size="lg"
                      className={resumeFile ? 'text-on-tertiary-container' : 'text-on-surface-variant'} />
                  </div>
                  {resumeFile ? (
                    <>
                      <p className="font-bold text-on-surface">{resumeFile.name}</p>
                      <p className="text-xs text-on-surface-variant mt-1">{(resumeFile.size / 1024).toFixed(1)} KB — click or drop to replace</p>
                    </>
                  ) : (
                    <>
                      <p className="font-bold text-on-surface">Drag & drop your resume</p>
                      <p className="text-xs text-on-surface-variant mt-1">PDF or TXT, up to 10 MB</p>
                    </>
                  )}
                </div>
              )}

              {error && (
                <div className="mt-4 flex items-start gap-2 rounded-xl bg-error-container px-4 py-3">
                  <Icon name="error" size="sm" className="text-on-error-container mt-0.5" />
                  <p className="text-sm font-semibold text-on-error-container">{error}</p>
                </div>
              )}

              <button onClick={handleSubmit} disabled={loading}
                className="mt-5 w-full flex items-center justify-center gap-2.5 rounded-xl bg-primary py-4 text-sm font-extrabold text-on-primary hover:bg-primary/90 active:scale-[0.99] transition-all disabled:opacity-50"
              >
                {loading ? (
                  <><span className="animate-spin inline-block"><Icon name="progress_activity" size="sm" /></span>Analyzing Resume...</>
                ) : (
                  <><Icon name="rocket_launch" size="sm" />Analyze My Resume</>
                )}
              </button>
            </div>
          </div>

          {/* Features row — below form */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mt-10 max-w-2xl mx-auto">
            {[
              { icon: 'psychology', title: 'Skill Analysis', desc: 'AI extracts & maps your skills' },
              { icon: 'compare_arrows', title: 'Job Matching', desc: 'Multi-dimension scoring' },
              { icon: 'school', title: 'Learning Paths', desc: 'Courses to close gaps' },
              { icon: 'mail', title: 'Cover Letters', desc: 'Tailored to each role' },
            ].map(f => (
              <div key={f.icon} className="flex flex-col items-center text-center p-4 rounded-xl bg-surface-container-low/50">
                <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center mb-3">
                  <span className="material-symbols-outlined text-primary">{f.icon}</span>
                </div>
                <p className="text-xs font-bold text-on-surface mb-0.5">{f.title}</p>
                <p className="text-[11px] text-on-surface-variant">{f.desc}</p>
              </div>
            ))}
          </div>

          {/* Trust line */}
          <p className="text-center text-[11px] text-on-surface-variant/50 mt-8 flex items-center justify-center gap-1.5">
            <span className="material-symbols-outlined text-xs">lock</span>
            Your data is encrypted and never shared with third parties
          </p>
        </div>
      </main>
    </div>
  );
}
