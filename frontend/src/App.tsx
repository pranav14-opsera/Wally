import { BrowserRouter, Route, Routes } from 'react-router-dom';

import { ErrorBoundary } from './components/ErrorBoundary';
import { NavShell } from './components/NavShell';
import { ProtectedRoute } from './components/ProtectedRoute';
import { AuthProvider } from './context/AuthContext';
import { ApiLifecyclePage } from './pages/ApiLifecyclePage';
import { ApiLifecycleRunPage } from './pages/ApiLifecycleRunPage';
import { IntegrationPage } from './pages/IntegrationPage';
import { IntegrationRunPage } from './pages/IntegrationRunPage';
import { LoadTestRunPage } from './pages/LoadTestRunPage';
import { LoadTestsPage } from './pages/LoadTestsPage';
import { LoginPage } from './pages/LoginPage';
import { NotFoundPage } from './pages/NotFoundPage';

export default function App() {
  return (
    <ErrorBoundary>
      <BrowserRouter>
        <AuthProvider>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route element={<ProtectedRoute />}>
              <Route element={<NavShell />}>
                <Route path="/" element={<LoadTestsPage />} />
                <Route path="/load-tests" element={<LoadTestsPage />} />
                <Route path="/load-tests/:jobId" element={<LoadTestRunPage />} />
                <Route path="/integration" element={<IntegrationPage />} />
                <Route path="/integration/:jobId" element={<IntegrationRunPage />} />
                <Route path="/api-lifecycle" element={<ApiLifecyclePage />} />
                <Route path="/api-lifecycle/:jobId" element={<ApiLifecycleRunPage />} />
                <Route path="*" element={<NotFoundPage />} />
              </Route>
            </Route>
            <Route path="*" element={<NotFoundPage />} />
          </Routes>
        </AuthProvider>
      </BrowserRouter>
    </ErrorBoundary>
  );
}
