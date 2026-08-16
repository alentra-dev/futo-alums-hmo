import { Navigate, Route, Routes } from 'react-router-dom';
import { useApp } from './context/AppContext';
import { AppShell } from './components/AppShell';
import { LoginPage } from './pages/LoginPage';
import { LoadingPage } from './pages/LoadingPage';
import { DashboardPage } from './pages/DashboardPage';
import { PlansPage } from './pages/PlansPage';
import { EnrollmentPage } from './pages/EnrollmentPage';
import { PaymentsPage } from './pages/PaymentsPage';

import { PrivacyPage } from './pages/PrivacyPage';
import { HistoryPage } from './pages/HistoryPage';
import { lazy, Suspense, type ReactNode } from 'react';

const AdminDashboardPage = lazy(() => import('./pages/admin/AdminDashboardPage').then((module) => ({ default: module.AdminDashboardPage })));
const AdminEnrolleesPage = lazy(() => import('./pages/admin/AdminEnrolleesPage').then((module) => ({ default: module.AdminEnrolleesPage })));
const AdminPaymentsPage = lazy(() => import('./pages/admin/AdminPaymentsPage').then((module) => ({ default: module.AdminPaymentsPage })));
const AdminSettingsPage = lazy(() => import('./pages/admin/AdminSettingsPage').then((module) => ({ default: module.AdminSettingsPage })));
const AuditPage = lazy(() => import('./pages/admin/AuditPage').then((module) => ({ default: module.AuditPage })));

function AdminGuard({ children }: { children: ReactNode }) {
  const { snapshot } = useApp();
  return snapshot?.profile.role === 'admin' || snapshot?.profile.role === 'owner' ? children : <Navigate to="/" replace />;
}

export default function App() {
  const { loading, authenticated, snapshot } = useApp();
  if (loading) return <LoadingPage />;

  return <Suspense fallback={<LoadingPage />}><Routes>
    <Route path="/login" element={authenticated && snapshot ? <Navigate to="/" replace /> : <LoginPage />} />
    <Route path="/privacy" element={<PrivacyPage />} />
    <Route element={authenticated && snapshot ? <AppShell /> : <Navigate to="/login" replace />}>
      <Route index element={<DashboardPage />} />
      <Route path="enrollment" element={<EnrollmentPage />} />
      <Route path="plans" element={<PlansPage />} />
      <Route path="payments" element={<PaymentsPage />} />
      <Route path="history" element={<HistoryPage />} />
      <Route path="admin" element={<AdminGuard><AdminDashboardPage /></AdminGuard>} />
      <Route path="admin/enrollees" element={<AdminGuard><AdminEnrolleesPage /></AdminGuard>} />
      <Route path="admin/payments" element={<AdminGuard><AdminPaymentsPage /></AdminGuard>} />
      <Route path="admin/settings" element={<AdminGuard><AdminSettingsPage /></AdminGuard>} />
      <Route path="admin/audit" element={<AdminGuard><AuditPage /></AdminGuard>} />
    </Route>
    <Route path="*" element={<Navigate to={authenticated ? '/' : '/login'} replace />} />
  </Routes></Suspense>;
}
