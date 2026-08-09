import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import { AuthProvider, useAuth } from './context/AuthContext';
import Layout from './components/Layout';
import LoginPage from './pages/LoginPage';
import Dashboard from './pages/Dashboard';
import UsersPage from './pages/UsersPage';
import RolesPage from './pages/RolesPage';
import ApplicationsPage from './pages/ApplicationsPage';
import EntitlementsPage from './pages/EntitlementsPage';
import AccessRequestsPage from './pages/AccessRequestsPage';
import CertificationsPage from './pages/CertificationsPage';
import PoliciesPage from './pages/PoliciesPage';
import AuditPage from './pages/AuditPage';
import CABPage from './pages/CABPage';
import ConnectorsPage from './pages/ConnectorsPage';
import PluginsPage from './pages/PluginsPage';
import LogsPage from './pages/LogsPage';
import ReportsPage from './pages/ReportsPage';
import ProfilePage from './pages/ProfilePage';
import PlatformStudioPage from './pages/PlatformStudioPage';
import DeveloperConsolePage from './pages/DeveloperConsolePage';
import AggregationStudioPage from './pages/AggregationStudioPage';
import WorkgroupsPage from './pages/WorkgroupsPage';
import GlobalSettingsPage from './pages/GlobalSettingsPage';
import SecurityPage from './pages/SecurityPage';
import AccessRequestSetupPage from './pages/AccessRequestSetupPage';
import ApprovalsPage from './pages/ApprovalsPage';
import SamlCallbackPage from './pages/SamlCallbackPage';
import MockIdpPage from './pages/MockIdpPage';
import IdentityMappingPage from './pages/IdentityMappingPage';
import LifecycleEventsPage from './pages/LifecycleEventsPage';
import CapabilitiesPage from './pages/CapabilitiesPage';
import ProvisioningPage from './pages/ProvisioningPage';

function ProtectedRoute({ children }) {
  const { user, loading } = useAuth();
  if (loading) return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center">
      <div className="text-center">
        <div className="w-12 h-12 border-4 border-cyan-500 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
        <p className="text-slate-400 text-sm">Loading NexusIAM...</p>
      </div>
    </div>
  );
  return user ? children : <Navigate to="/login" replace />;
}

function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Toaster
          position="top-right"
          toastOptions={{
            style: { background: 'var(--bg-tertiary)', color: 'var(--text-primary)', border: '1px solid #334155' },
            success: { iconTheme: { primary: '#06b6d4', secondary: 'var(--bg-secondary)' } },
            error: { iconTheme: { primary: '#ef4444', secondary: 'var(--bg-secondary)' } } }}
        />
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/saml/callback" element={<SamlCallbackPage />} />
          <Route path="/saml/mock-idp" element={<MockIdpPage />} />
          <Route path="/" element={<ProtectedRoute><Layout /></ProtectedRoute>}>
            <Route index element={<Navigate to="/dashboard" replace />} />
            <Route path="dashboard" element={<Dashboard />} />
            <Route path="users" element={<UsersPage />} />
            <Route path="roles" element={<RolesPage />} />
            <Route path="applications" element={<ApplicationsPage />} />
            <Route path="entitlements" element={<EntitlementsPage />} />
            <Route path="access-requests" element={<AccessRequestsPage />} />
            <Route path="certifications" element={<CertificationsPage />} />
            <Route path="policies" element={<PoliciesPage />} />
            <Route path="audit" element={<AuditPage />} />
            <Route path="cab" element={<CABPage />} />
            <Route path="connectors" element={<ConnectorsPage />} />
            <Route path="plugins" element={<PluginsPage />} />
            <Route path="logs" element={<LogsPage />} />
            <Route path="reports" element={<ReportsPage />} />
            <Route path="studio" element={<PlatformStudioPage />} />
            <Route path="developer-console" element={<DeveloperConsolePage />} />
            <Route path="aggregations" element={<AggregationStudioPage />} />
            <Route path="lifecycle" element={<LifecycleEventsPage />} />
            <Route path="capabilities" element={<CapabilitiesPage />} />
            <Route path="provisioning" element={<ProvisioningPage />} />
            <Route path="profile" element={<ProfilePage />} />
            <Route path="workgroups" element={<WorkgroupsPage />} />
            <Route path="settings" element={<GlobalSettingsPage />} />
            <Route path="settings/identity-mapping" element={<IdentityMappingPage />} />
            <Route path="settings/security" element={<SecurityPage />} />
            <Route path="settings/access-request-setup" element={<AccessRequestSetupPage />} />
            <Route path="approvals" element={<ApprovalsPage />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}

export default App;
