# Pelgo Frontend — React + Vite + Tailwind

Production dashboard for the Pelgo AI Career Intelligence system. Built with React 19, Vite 8, Tailwind CSS 4, and the Pelgo Meridian design system.

## Quick Start

```bash
# Install dependencies
npm install

# Development server (proxies /api to backend at localhost:8001)
npm run dev
# → http://localhost:3000

# Production build
npm run build
```

**Requirement:** Backend API must be running at `http://localhost:8001` (via `docker-compose up postgres redis api worker-1 worker-2`).

## Pages

| Route | Page | Description |
|-------|------|-------------|
| `/onboarding` | Onboarding | First-time user resume upload (standalone, no shell) |
| `/` | Dashboard | Stats, match list with live progress, profile sidebar |
| `/upload` | Upload/Update | Resume upload + JD submission (inside shell) |
| `/matches/:id` | Job Analysis | Score gauge, radar chart, skills grid, AI reasoning, cover letter, company profile |
| `/matches/:id/learn` | Learning Path | Skill sections, resource cards, assessment buttons |
| `/matches/:id/trace` | Agent Trace | Execution timeline, JSON panel, efficiency metrics |
| `/cv-editor` | CV Editor | Markdown editor + live preview + AI revision + PDF export |
| `/compare` | Compare Mode | Side-by-side match comparison |
| `/assessment` | Skill Assessment | AI-generated quiz with verification tracking |

## Design System (Pelgo Meridian)

- 40+ color tokens (deep indigo primary, teal growth)
- No 1px borders — tonal surface layering
- Glassmorphic navigation
- Material Symbols Outlined icons
- Dark mode with full token overrides
- Responsive (desktop + mobile)

## Tech Stack

- **React 19** — UI framework
- **Vite 8** — Build tool with HMR
- **Tailwind CSS 4** — Utility-first styling with `@theme` tokens
- **React Router 7** — Client-side routing
- **TypeScript 5.9** — Type safety

## Project Structure

```
src/
  App.tsx                     # Router configuration
  main.tsx                    # Entry point (BrowserRouter + providers)
  index.css                   # Meridian design tokens

  context/
    CandidateContext.tsx       # Candidate + matches state (localStorage)
    ThemeContext.tsx           # Dark/light mode toggle

  layouts/
    DashboardShell.tsx        # TopNav + SideNav + Outlet
    TopNav.tsx                # Glassmorphic top bar
    SideNav.tsx               # Sidebar navigation

  pages/                      # 9 page components
  components/shared/          # 13 reusable components
  hooks/                      # Keyboard shortcuts
  lib/
    api.ts                    # Typed API client (15 endpoints)
    skills.ts                 # Verified skills storage
```
