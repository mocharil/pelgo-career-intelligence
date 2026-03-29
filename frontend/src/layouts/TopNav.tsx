import { NavLink } from 'react-router-dom';
import { useCandidate } from '../context/CandidateContext';
import { useTheme } from '../context/ThemeContext';

const navLinks = [
  { to: '/', label: 'Dashboard' },
];

export default function TopNav() {
  const { candidate, clearSession } = useCandidate();
  const { dark, toggle } = useTheme();
  const initials = candidate?.name?.split(' ').map(n => n[0]).join('').slice(0, 2) || '?';

  return (
    <nav className="fixed top-0 w-full z-50 bg-surface/80 backdrop-blur-xl">
      <div className="flex justify-between items-center px-8 h-16 w-full max-w-screen-2xl mx-auto">
        <span className="text-2xl font-extrabold tracking-tighter text-primary">Pelgo</span>

        <div className="hidden md:flex items-center gap-6">
          {navLinks.map(link => (
            <NavLink
              key={link.label}
              to={link.to}
              className={({ isActive }) =>
                `text-sm font-medium transition-colors ${
                  isActive ? 'text-primary font-bold border-b-2 border-secondary' : 'text-on-surface-variant hover:text-secondary'
                }`
              }
            >
              {link.label}
            </NavLink>
          ))}
        </div>

        <div className="flex items-center gap-3">
          <div className="hidden lg:flex items-center gap-2 text-[10px] text-on-surface-variant/60 font-mono">
            <kbd className="px-1.5 py-0.5 rounded bg-surface-container-high">Ctrl+N</kbd><span>New Match</span>
            <kbd className="px-1.5 py-0.5 rounded bg-surface-container-high ml-2">Ctrl+E</kbd><span>CV Editor</span>
          </div>

          <button onClick={toggle} className="w-9 h-9 rounded-full bg-surface-container flex items-center justify-center hover:bg-surface-container-high transition-colors" title={dark ? 'Light mode' : 'Dark mode'}>
            <span className="material-symbols-outlined text-on-surface-variant text-lg">{dark ? 'light_mode' : 'dark_mode'}</span>
          </button>

          <button onClick={clearSession} className="w-9 h-9 rounded-full bg-primary text-on-primary flex items-center justify-center text-sm font-bold hover:opacity-90 transition-opacity" title="Reset session">
            {initials}
          </button>
        </div>
      </div>
    </nav>
  );
}
