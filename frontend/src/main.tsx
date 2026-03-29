import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { CandidateProvider } from './context/CandidateContext';
import { ThemeProvider } from './context/ThemeContext';
import App from './App';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <ThemeProvider>
        <CandidateProvider>
          <App />
        </CandidateProvider>
      </ThemeProvider>
    </BrowserRouter>
  </StrictMode>
);
