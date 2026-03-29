import { Outlet, Navigate } from 'react-router-dom';
import { useCandidate } from '../context/CandidateContext';
import { useKeyboardShortcuts } from '../hooks/useKeyboardShortcuts';
import TopNav from './TopNav';
import SideNav from './SideNav';

export default function DashboardShell() {
  const { candidate } = useCandidate();
  useKeyboardShortcuts();

  if (!candidate) return <Navigate to="/onboarding" replace />;

  return (
    <div className="min-h-screen bg-surface">
      <TopNav />
      <SideNav />
      <main className="lg:ml-64 pt-24 px-6 lg:px-10 pb-12">
        <div className="animate-fade-in">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
