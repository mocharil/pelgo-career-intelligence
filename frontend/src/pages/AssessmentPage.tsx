import { useState, useEffect } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { useCandidate } from '../context/CandidateContext';
import { generateAssessment, gradeAssessment } from '../lib/api';
import { verifySkill } from '../lib/skills';
import type { QuizQuestion, QuizResult } from '../lib/api';
import Icon from '../components/shared/Icon';

type Phase = 'loading' | 'quiz' | 'grading' | 'results';

export default function AssessmentPage() {
  const [searchParams] = useSearchParams();
  const skill = searchParams.get('skill') || '';
  const seniority = searchParams.get('seniority') || 'mid';
  const { candidate } = useCandidate();

  const [phase, setPhase] = useState<Phase>('loading');
  const [questions, setQuestions] = useState<QuizQuestion[]>([]);
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const [currentQ, setCurrentQ] = useState(0);
  const [result, setResult] = useState<QuizResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Load saved results from localStorage
  const storageKey = `pelgo_assessment_${skill}`;
  const [savedResults, setSavedResults] = useState<QuizResult[]>(() => {
    try { return JSON.parse(localStorage.getItem(storageKey) || '[]'); } catch { return []; }
  });

  useEffect(() => {
    if (!skill) return;
    setPhase('loading');
    generateAssessment(skill, seniority)
      .then(data => { setQuestions(data.questions); setPhase('quiz'); })
      .catch(err => { setError(err.message); setPhase('quiz'); });
  }, [skill, seniority]);

  const handleAnswer = (questionId: number, answer: string) => {
    setAnswers(prev => ({ ...prev, [questionId]: answer }));
  };

  const handleSubmit = async () => {
    setPhase('grading');
    try {
      const answerList = Object.entries(answers).map(([qId, ans]) => ({ question_id: Number(qId), answer: ans }));
      const res = await gradeAssessment(skill, seniority, questions, answerList);
      setResult(res);
      // Save to localStorage
      const updated = [...savedResults, res];
      setSavedResults(updated);
      localStorage.setItem(storageKey, JSON.stringify(updated));
      // Mark skill as verified if passed
      if (res.passed) verifySkill(skill, res.score);
      setPhase('results');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Grading failed');
      setPhase('results');
    }
  };

  const handleRetake = () => {
    setAnswers({});
    setCurrentQ(0);
    setResult(null);
    setPhase('loading');
    generateAssessment(skill, seniority)
      .then(data => { setQuestions(data.questions); setPhase('quiz'); })
      .catch(err => { setError(err.message); setPhase('quiz'); });
  };

  const answeredCount = Object.keys(answers).length;
  const q = questions[currentQ];
  const bestScore = savedResults.length > 0 ? Math.max(...savedResults.map(r => r.score)) : null;

  if (!skill) {
    return (
      <div className="flex flex-col items-center justify-center py-32">
        <Icon name="quiz" size="lg" className="text-on-surface-variant mb-4" />
        <p className="text-on-surface-variant">No skill specified. Go to a Learning Path and click "Take Assessment".</p>
        <Link to="/" className="mt-4 text-sm font-bold text-secondary hover:underline">Back to Dashboard</Link>
      </div>
    );
  }

  return (
    <div>
      <Link to="/" className="inline-flex items-center gap-1.5 text-sm font-bold text-on-surface-variant hover:text-secondary transition-colors mb-6">
        <Icon name="arrow_back" size="sm" />
        Back to Dashboard
      </Link>

      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <div className="flex items-center gap-3 mb-2">
            <div className="w-10 h-10 rounded-xl bg-secondary-fixed flex items-center justify-center">
              <Icon name="quiz" size="md" className="text-secondary" />
            </div>
            <div>
              <h1 className="text-2xl font-extrabold text-on-surface tracking-tight">{skill} Assessment</h1>
              <p className="text-xs text-on-surface-variant">{seniority} level · 5 questions</p>
            </div>
          </div>
        </div>
        {bestScore !== null && (
          <div className="text-right">
            <p className="text-xs text-on-surface-variant uppercase tracking-wider font-bold">Best Score</p>
            <p className={`text-2xl font-extrabold ${bestScore >= 80 ? 'text-on-tertiary-container' : bestScore >= 60 ? 'text-secondary' : 'text-error'}`}>
              {bestScore}%
            </p>
            <p className="text-[10px] text-on-surface-variant">{savedResults.length} attempt{savedResults.length !== 1 ? 's' : ''}</p>
          </div>
        )}
      </div>

      {/* Loading */}
      {phase === 'loading' && (
        <div className="flex flex-col items-center justify-center py-20">
          <div className="w-16 h-16 rounded-full bg-secondary-fixed flex items-center justify-center mb-4">
            <span className="material-symbols-outlined text-secondary text-2xl animate-spin">progress_activity</span>
          </div>
          <p className="text-on-surface font-bold">Generating your assessment...</p>
          <p className="text-sm text-on-surface-variant mt-1">AI is creating questions tailored to your level</p>
        </div>
      )}

      {/* Error */}
      {error && phase !== 'results' && (
        <div className="rounded-xl bg-error-container px-5 py-4 mb-6">
          <p className="text-sm font-semibold text-on-error-container">{error}</p>
        </div>
      )}

      {/* Quiz */}
      {phase === 'quiz' && questions.length > 0 && (
        <div>
          {/* Progress bar */}
          <div className="flex items-center gap-3 mb-6">
            <div className="flex-1 flex gap-1">
              {questions.map((_, i) => (
                <div key={i} className={`h-2 flex-1 rounded-full transition-all duration-300 cursor-pointer ${
                  answers[questions[i]?.id] ? 'bg-tertiary-fixed shadow-[0_0_6px_rgba(111,251,190,0.3)]'
                    : i === currentQ ? 'bg-secondary' : 'bg-surface-container-high'
                }`} onClick={() => setCurrentQ(i)} />
              ))}
            </div>
            <span className="text-xs font-bold text-on-surface-variant">{answeredCount}/{questions.length}</span>
          </div>

          {/* Question card */}
          {q && (
            <div className="bg-surface-container-lowest rounded-2xl p-8 mb-6 animate-fade-in" key={q.id}>
              <div className="flex items-center gap-2 mb-4">
                <span className="w-8 h-8 rounded-full bg-primary text-on-primary flex items-center justify-center text-sm font-bold">
                  {currentQ + 1}
                </span>
                <span className="text-xs text-on-surface-variant font-bold uppercase tracking-wider">Question {currentQ + 1} of {questions.length}</span>
              </div>

              <p className="text-lg font-bold text-on-surface leading-relaxed mb-6">{q.question}</p>

              <div className="space-y-3">
                {q.options.map((opt, i) => {
                  const letter = String.fromCharCode(65 + i); // A, B, C, D
                  const selected = answers[q.id] === letter;
                  return (
                    <button key={i} onClick={() => handleAnswer(q.id, letter)}
                      className={`w-full text-left flex items-center gap-4 p-4 rounded-xl transition-all ${
                        selected
                          ? 'bg-primary text-on-primary shadow-md'
                          : 'bg-surface-container-low text-on-surface hover:bg-surface-container'
                      }`}
                    >
                      <span className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold shrink-0 ${
                        selected ? 'bg-on-primary text-primary' : 'bg-surface-container-high text-on-surface-variant'
                      }`}>
                        {letter}
                      </span>
                      <span className="text-sm font-medium">{opt}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Navigation */}
          <div className="flex items-center justify-between">
            <button onClick={() => setCurrentQ(Math.max(0, currentQ - 1))} disabled={currentQ === 0}
              className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-surface-container-high text-on-surface text-sm font-bold hover:bg-surface-container-highest transition-colors disabled:opacity-30"
            >
              <Icon name="arrow_back" size="sm" /> Previous
            </button>

            {currentQ < questions.length - 1 ? (
              <button onClick={() => setCurrentQ(currentQ + 1)}
                className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-primary text-on-primary text-sm font-bold hover:opacity-90 transition-opacity"
              >
                Next <Icon name="arrow_forward" size="sm" />
              </button>
            ) : (
              <button onClick={handleSubmit} disabled={answeredCount < questions.length}
                className="flex items-center gap-1.5 px-6 py-2.5 rounded-xl bg-tertiary-fixed text-on-tertiary-fixed text-sm font-extrabold hover:opacity-90 transition-opacity disabled:opacity-40"
              >
                <Icon name="check_circle" size="sm" /> Submit Assessment
              </button>
            )}
          </div>
        </div>
      )}

      {/* Grading */}
      {phase === 'grading' && (
        <div className="flex flex-col items-center justify-center py-20">
          <div className="w-16 h-16 rounded-full bg-tertiary-fixed/20 flex items-center justify-center mb-4">
            <span className="material-symbols-outlined text-on-tertiary-container text-2xl animate-spin">grading</span>
          </div>
          <p className="text-on-surface font-bold">Grading your assessment...</p>
        </div>
      )}

      {/* Results */}
      {phase === 'results' && result && (
        <div className="space-y-6 animate-fade-in">
          {/* Score card */}
          <div className={`rounded-2xl p-8 text-center ${result.passed ? 'bg-tertiary-fixed/15' : 'bg-error-container/30'}`}>
            {result.passed && (
              <div className="flex items-center justify-center gap-2 mb-3">
                <Icon name="verified" size="md" className="text-on-tertiary-container" filled />
                <span className="text-xs font-bold text-on-tertiary-container uppercase tracking-widest">Skill Verified</span>
              </div>
            )}
            <p className={`text-6xl font-extrabold mb-2 ${result.passed ? 'text-on-tertiary-container' : 'text-error'}`}>
              {result.score}%
            </p>
            <p className={`text-lg font-bold mb-1 ${result.passed ? 'text-on-tertiary-container' : 'text-on-error-container'}`}>
              {result.score >= 80 ? 'Excellent! Skill Mastered' : result.passed ? 'Assessment Passed!' : 'Keep Practicing'}
            </p>
            <p className="text-sm text-on-surface-variant max-w-md mx-auto mb-4">{result.feedback}</p>
            {result.passed && (
              <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-tertiary-fixed/20 text-on-tertiary-container text-xs font-bold">
                <Icon name="check_circle" size="sm" />
                "{skill}" is now verified on your profile — gap skills updated across all matches
              </div>
            )}
          </div>

          {/* Per-question review */}
          <div className="space-y-3">
            {result.results.map((r, i) => {
              const q = questions.find(q => q.id === r.id);
              return (
                <div key={r.id} className={`rounded-xl p-5 ${r.correct ? 'bg-surface-container-lowest' : 'bg-error-container/10'}`}>
                  <div className="flex items-start gap-3">
                    <div className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 ${
                      r.correct ? 'bg-tertiary-fixed/20 text-on-tertiary-container' : 'bg-error-container text-on-error-container'
                    }`}>
                      <Icon name={r.correct ? 'check' : 'close'} size="sm" />
                    </div>
                    <div className="flex-1">
                      <p className="text-sm font-bold text-on-surface mb-1">{q?.question}</p>
                      <div className="flex gap-4 text-xs mb-2">
                        <span className={r.correct ? 'text-on-tertiary-container font-bold' : 'text-error font-bold'}>
                          Your answer: {r.your_answer}
                        </span>
                        {!r.correct && (
                          <span className="text-on-tertiary-container font-bold">Correct: {r.correct_answer}</span>
                        )}
                      </div>
                      <p className="text-xs text-on-surface-variant">{r.explanation}</p>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Actions */}
          <div className="flex gap-3">
            <button onClick={handleRetake}
              className="flex-1 flex items-center justify-center gap-2 px-6 py-3.5 rounded-xl bg-primary text-on-primary text-sm font-bold hover:opacity-90 transition-opacity"
            >
              <Icon name="replay" size="sm" /> Retake Assessment
            </button>
            <Link to="/"
              className="flex-1 flex items-center justify-center gap-2 px-6 py-3.5 rounded-xl bg-surface-container-high text-on-surface text-sm font-bold hover:bg-surface-container-highest transition-colors"
            >
              <Icon name="dashboard" size="sm" /> Back to Dashboard
            </Link>
          </div>

          {/* History */}
          {savedResults.length > 1 && (
            <div className="bg-surface-container-lowest rounded-xl p-5">
              <h3 className="text-sm font-bold text-on-surface uppercase tracking-wider mb-3">Attempt History</h3>
              <div className="flex gap-2">
                {savedResults.map((r, i) => (
                  <div key={i} className={`flex-1 text-center p-3 rounded-lg ${
                    r.passed ? 'bg-tertiary-fixed/10' : 'bg-surface-container-low'
                  }`}>
                    <p className={`text-lg font-extrabold ${r.passed ? 'text-on-tertiary-container' : 'text-on-surface-variant'}`}>{r.score}%</p>
                    <p className="text-[10px] text-on-surface-variant">#{i + 1}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
