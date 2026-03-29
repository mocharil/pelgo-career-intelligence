import { NavLink, useLocation } from 'react-router-dom';
import { useCandidate } from '../context/CandidateContext';

const navItems = [
  { to: '/', icon: 'dashboard', label: 'Dashboard', exact: true },
  { to: '/upload?step=2', icon: 'work', label: 'New Match' },
  { to: '/compare', icon: 'compare', label: 'Compare Jobs' },
  { to: '/cv-editor', icon: 'edit_document', label: 'CV Editor' },
  { to: '/upload', icon: 'person', label: 'Update Profile' },
];

export default function SideNav() {
  const location = useLocation();
  const { matches } = useCandidate();

  // Compute growth score from completed matches
  const completed = matches.filter(m => m.status === 'completed' && m.result);
  const avgScore = completed.length > 0
    ? Math.round(completed.reduce((s, m) => s + (m.result?.overall_score ?? 0), 0) / completed.length)
    : 0;

  const isActive = (item: typeof navItems[0]) => {
    if (item.exact) return location.pathname === '/' || location.pathname.startsWith('/matches');
    return location.pathname + location.search === item.to;
  };

  return (
    <aside className="h-screen w-64 fixed left-0 top-0 z-40 bg-surface-container-low flex flex-col pt-20 pb-8 hidden lg:flex">
      <div className="px-6 mb-8">
        <h2 className="text-lg font-bold text-primary">The Architect</h2>
        <p className="text-xs text-on-surface-variant font-medium">Career Intelligence</p>
      </div>

      <nav className="flex-1 px-3 space-y-1">
        {navItems.map(item => (
          <NavLink
            key={item.label}
            to={item.to}
            className={`flex items-center gap-3 py-2.5 px-4 rounded-xl text-sm transition-all ${
              isActive(item)
                ? 'bg-surface-container-lowest text-primary font-bold shadow-sm'
                : 'text-on-surface-variant font-medium hover:bg-surface-container hover:translate-x-1'
            }`}
          >
            <span className="material-symbols-outlined text-xl" style={isActive(item) ? { fontVariationSettings: "'FILL' 1" } : undefined}>
              {item.icon}
            </span>
            {item.label}
          </NavLink>
        ))}
      </nav>

      <div className="px-4 mt-auto">
        <div className="bg-primary-container p-5 rounded-2xl text-on-primary">
          <p className="text-[10px] font-bold uppercase tracking-widest text-on-primary-container mb-2">Growth Score</p>
          <p className="text-3xl font-extrabold text-tertiary-fixed mb-1">{avgScore > 0 ? `${avgScore}%` : '--'}</p>
          <div className="h-1.5 w-full bg-white/10 rounded-full overflow-hidden mt-3">
            <div className="h-full bg-tertiary-fixed rounded-full shadow-[0_0_8px_rgba(111,251,190,0.5)] transition-all duration-500" style={{ width: `${avgScore}%` }} />
          </div>
          <p className="text-[10px] text-on-primary-container mt-2">Career readiness</p>
        </div>
      </div>
    </aside>
  );
}
