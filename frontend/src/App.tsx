import { Routes, Route } from 'react-router-dom';
import DashboardShell from './layouts/DashboardShell';
import OnboardingPage from './pages/OnboardingPage';
import UploadPage from './pages/UploadPage';
import DashboardPage from './pages/DashboardPage';
import JobAnalysisPage from './pages/JobAnalysisPage';
import LearningPathPage from './pages/LearningPathPage';
import AgentTracePage from './pages/AgentTracePage';
import CvEditorPage from './pages/CvEditorPage';
import ComparePage from './pages/ComparePage';
import AssessmentPage from './pages/AssessmentPage';

export default function App() {
  return (
    <Routes>
      {/* Standalone onboarding for first-time users (no shell) */}
      <Route path="/onboarding" element={<OnboardingPage />} />

      {/* All other pages inside the dashboard shell */}
      <Route element={<DashboardShell />}>
        <Route index element={<DashboardPage />} />
        <Route path="/upload" element={<UploadPage />} />
        <Route path="/matches/:jobId" element={<JobAnalysisPage />} />
        <Route path="/matches/:jobId/learn" element={<LearningPathPage />} />
        <Route path="/matches/:jobId/trace" element={<AgentTracePage />} />
        <Route path="/cv-editor" element={<CvEditorPage />} />
        <Route path="/compare" element={<ComparePage />} />
        <Route path="/assessment" element={<AssessmentPage />} />
      </Route>
    </Routes>
  );
}
