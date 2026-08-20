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
const AdminAccessPage = lazy(() => import('./pages/admin/AdminAccessPage').then((module) => ({ default: module.AdminAccessPage })));

function AdminGuard({ children }: { children: ReactNode }) {
  const { snapshot } = useApp();
  return snapshot?.profile.role === 'admin' || snapshot?.profile.role === 'owner' ? children : <Navigate to="/" replace />;
}

function SubscriberGuard({ children }: { children: ReactNode }) {
  const { snapshot } = useApp();
  const canAdmin = snapshot?.profile.role === 'admin' || snapshot?.profile.role === 'owner';
  return snapshot?.subscriberEnrollmentIds.length ? children : <Navigate to={canAdmin ? '/admin' : '/login'} replace />;
}

export default function App() {
  const { loading, authenticated, snapshot } = useApp();
  if (loading) return <LoadingPage />;
  const canAdmin = snapshot?.profile.role === 'admin' || snapshot?.profile.role === 'owner';

  return <Suspense fallback={<LoadingPage />}><Routes>
    <Route path="/login" element={authenticated && snapshot ? <Navigate to="/" replace /> : <LoginPage />} />
    <Route path="/privacy" element={<PrivacyPage />} />
    <Route element={authenticated && snapshot ? <AppShell /> : <Navigate to="/login" replace />}>
      <Route index element={canAdmin ? <Navigate to="/admin" replace /> : <SubscriberGuard><DashboardPage /></SubscriberGuard>} />
      <Route path="account" element={<SubscriberGuard><DashboardPage /></SubscriberGuard>} />
      <Route path="enrollment" element={<SubscriberGuard><EnrollmentPage /></SubscriberGuard>} />
      <Route path="plans" element={<SubscriberGuard><PlansPage /></SubscriberGuard>} />
      <Route path="payments" element={<SubscriberGuard><PaymentsPage /></SubscriberGuard>} />
      <Route path="history" element={<SubscriberGuard><HistoryPage /></SubscriberGuard>} />
      <Route path="admin" element={<AdminGuard><AdminDashboardPage /></AdminGuard>} />
      <Route path="admin/enrollees" element={<AdminGuard><AdminEnrolleesPage /></AdminGuard>} />
      <Route path="admin/payments" element={<AdminGuard><AdminPaymentsPage /></AdminGuard>} />
      <Route path="admin/settings" element={<AdminGuard><AdminSettingsPage /></AdminGuard>} />
      <Route path="admin/access" element={<AdminGuard><AdminAccessPage /></AdminGuard>} />
      <Route path="admin/audit" element={<AdminGuard><AuditPage /></AdminGuard>} />
    </Route>
    <Route path="*" element={<Navigate to={authenticated ? '/' : '/login'} replace />} />
  </Routes></Suspense>;
}
