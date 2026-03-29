import { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from 'react';
import { listMatches } from '../lib/api';
import type { CandidateResponse, MatchJob } from '../lib/api';

interface CandidateState {
  candidate: CandidateResponse | null;
  matches: MatchJob[];
  loading: boolean;
  setCandidate: (c: CandidateResponse) => void;
  refreshMatches: () => Promise<void>;
  clearSession: () => void;
}

const CandidateContext = createContext<CandidateState | null>(null);

export function CandidateProvider({ children }: { children: ReactNode }) {
  const [candidate, setCandidateState] = useState<CandidateResponse | null>(() => {
    const stored = localStorage.getItem('pelgo_candidate');
    return stored ? JSON.parse(stored) : null;
  });
  const [matches, setMatches] = useState<MatchJob[]>([]);
  const [loading, setLoading] = useState(false);

  const setCandidate = useCallback((c: CandidateResponse) => {
    setCandidateState(c);
    localStorage.setItem('pelgo_candidate', JSON.stringify(c));
  }, []);

  const refreshMatches = useCallback(async () => {
    if (!candidate) return;
    setLoading(true);
    try {
      const data = await listMatches(candidate.candidate_id, { limit: 100 });
      setMatches(data.jobs);
    } catch (e) {
      console.error('Failed to refresh matches', e);
    } finally {
      setLoading(false);
    }
  }, [candidate]);

  const clearSession = useCallback(() => {
    setCandidateState(null);
    setMatches([]);
    localStorage.removeItem('pelgo_candidate');
  }, []);

  // Auto-refresh on mount if candidate exists
  useEffect(() => {
    if (candidate) refreshMatches();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candidate?.candidate_id]);

  // Poll while any match is pending/processing
  const hasPending = matches.some(m => m.status === 'pending' || m.status === 'processing');
  useEffect(() => {
    if (!hasPending || !candidate) return;
    const interval = setInterval(() => refreshMatches(), 3000);
    return () => clearInterval(interval);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasPending, candidate?.candidate_id]);

  return (
    <CandidateContext.Provider value={{ candidate, matches, loading, setCandidate, refreshMatches, clearSession }}>
      {children}
    </CandidateContext.Provider>
  );
}

export function useCandidate() {
  const ctx = useContext(CandidateContext);
  if (!ctx) throw new Error('useCandidate must be used within CandidateProvider');
  return ctx;
}
