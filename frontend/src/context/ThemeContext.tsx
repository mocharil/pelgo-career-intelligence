import { createContext, useContext, useState, useEffect, type ReactNode } from 'react';

interface ThemeState {
  dark: boolean;
  toggle: () => void;
}

const ThemeContext = createContext<ThemeState>({ dark: false, toggle: () => {} });

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [dark, setDark] = useState(() => {
    const stored = localStorage.getItem('pelgo_theme');
    if (stored) return stored === 'dark';
    return false; // Default to light mode
  });

  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
    localStorage.setItem('pelgo_theme', dark ? 'dark' : 'light');
  }, [dark]);

  const toggle = () => setDark(d => !d);

  return (
    <ThemeContext.Provider value={{ dark, toggle }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}
