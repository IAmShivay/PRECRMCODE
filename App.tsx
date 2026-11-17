import React, { Suspense, lazy, useEffect, useState } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { ToastProvider } from './contexts/ToastContext';
import Navbar from './components/Navbar';
import Hero from './components/Hero';
import DashboardPreview from './components/DashboardPreview';
import Features from './components/Features';
import LogoCloud from './components/LogoCloud';
import CTA from './components/CTA';
import Footer from './components/Footer';
import Reveal from './components/Reveal';
import ProtectedRoute from './components/auth/ProtectedRoute';
import RouteErrorBoundary from './components/RouteErrorBoundary';
import type { ErrorBoundaryVariant } from './components/ErrorBoundary';

const Dashboard = lazy(() => import('./components/Dashboard'));
const DashboardLayout = lazy(() => import('./components/DashboardLayout'));
const Signup = lazy(() => import('./pages/Signup'));
const SignupWithInvite = lazy(() => import('./pages/SignupWithInvite'));
const Login = lazy(() => import('./pages/Login'));
const WorkspaceOnboarding = lazy(() => import('./pages/WorkspaceOnboarding'));
const CreateWorkspace = lazy(() => import('./pages/CreateWorkspace'));
const LeadsPage = lazy(() => import('./pages/LeadsPage'));
const LeadDetailPage = lazy(() => import('./pages/LeadDetailPage'));
const TrashPage = lazy(() => import('./pages/TrashPage'));
const DealsPage = lazy(() => import('./pages/DealsPage'));
const CustomersPage = lazy(() => import('./pages/CustomersPage'));
const ProspectsPage = lazy(() => import('./pages/ProspectsPage'));
const WebhookSources = lazy(() => import('./pages/WebhookSources'));
const WorkspaceSources = lazy(() => import('./pages/WorkspaceSources'));
const SourceDetailPage = lazy(() => import('./pages/SourceDetailPage'));
const WorkspaceSettings = lazy(() => import('./pages/WorkspaceSettings'));
const Analytics = lazy(() => import('./pages/Analytics'));
const Account = lazy(() => import('./pages/Account'));
const FacebookLeadAds = lazy(() => import('./pages/FacebookLeadAds'));
const WhatsAppIntegration = lazy(() => import('./pages/WhatsAppIntegration'));
const InstagramIntegration = lazy(() => import('./pages/InstagramIntegration'));
const PrivacyPolicy = lazy(() => import('./pages/PrivacyPolicy'));
const TermsOfService = lazy(() => import('./pages/TermsOfService'));
const DataDeletion = lazy(() => import('./pages/DataDeletion'));
const Support = lazy(() => import('./pages/Support'));
const McpSettingsPage = lazy(() => import('./pages/McpSettingsPage'));
const AutomationsPage = lazy(() => import('./pages/AutomationsPage'));
const TasksPage = lazy(() => import('./pages/TasksPage'));

const LandingPage: React.FC = () => {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const handleScroll = () => {
      setScrolled(window.scrollY > 20);
    };
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  return (
    <div className="min-h-screen selection:bg-black selection:text-white">
      <Navbar scrolled={scrolled} />
      <main>
        <Hero />

        <section className="px-6 pb-24 lg:pb-40 -mt-16 relative z-10">
          <Reveal delay={0.2} direction="none">
            <DashboardPreview />
          </Reveal>
        </section>

        <Reveal direction="right">
          <LogoCloud />
        </Reveal>

        <Reveal direction="left">
          <Features />
        </Reveal>

        <Reveal direction="right">
          <CTA />
        </Reveal>
      </main>
      <Footer />
    </div>
  );
};

const withRouteBoundary = (
  element: React.ReactNode,
  variant: ErrorBoundaryVariant = 'page',
) => (
  <RouteErrorBoundary variant={variant}>{element}</RouteErrorBoundary>
);

const App: React.FC = () => {
  return (
    <ToastProvider>
      <Suspense fallback={<div className="min-h-screen bg-white" />}>
        <Routes>
          <Route path="/" element={withRouteBoundary(<LandingPage />)} />
          <Route path="/privacy" element={withRouteBoundary(<PrivacyPolicy />)} />
          <Route path="/privacy-policy" element={withRouteBoundary(<PrivacyPolicy />)} />
          <Route path="/terms" element={withRouteBoundary(<TermsOfService />)} />
          <Route path="/terms-of-service" element={withRouteBoundary(<TermsOfService />)} />
          <Route path="/data-deletion" element={withRouteBoundary(<DataDeletion />)} />
          <Route path="/data-deletion-instructions" element={withRouteBoundary(<DataDeletion />)} />
          <Route path="/support" element={withRouteBoundary(<Support />)} />
          <Route path="/help" element={withRouteBoundary(<Support />)} />
          <Route path="/contact" element={withRouteBoundary(<Support />)} />
          <Route path="/contact-us" element={withRouteBoundary(<Support />)} />
          <Route path="/signup" element={withRouteBoundary(<Signup />)} />
          <Route path="/accept-invite/:token" element={withRouteBoundary(<SignupWithInvite />)} />
          <Route path="/login" element={withRouteBoundary(<Login />)} />
          <Route
            path="/onboarding/workspace"
            element={withRouteBoundary(
              <ProtectedRoute>
                <WorkspaceOnboarding />
              </ProtectedRoute>,
            )}
          />
          
          {/* Dashboard Layout Routes */}
          <Route
            element={withRouteBoundary(
              <ProtectedRoute requireWorkspace={false}>
                <DashboardLayout />
              </ProtectedRoute>,
              'app',
            )}
          >
            <Route path="/dashboard" element={withRouteBoundary(<Dashboard />)} />
            <Route path="/workspaces/new" element={withRouteBoundary(<CreateWorkspace />)} />
            <Route path="/leads" element={withRouteBoundary(<LeadsPage />)} />
            <Route path="/leads/:leadId" element={withRouteBoundary(<LeadDetailPage />)} />
            <Route path="/deals" element={withRouteBoundary(<DealsPage />)} />
            <Route path="/customers" element={withRouteBoundary(<CustomersPage />)} />
            <Route path="/prospects" element={withRouteBoundary(<ProspectsPage />)} />
            <Route path="/trash" element={withRouteBoundary(<TrashPage />)} />
            <Route path="/analytics" element={withRouteBoundary(<Analytics />)} />
            <Route path="/automations" element={withRouteBoundary(<AutomationsPage />)} />
            <Route path="/tasks" element={withRouteBoundary(<TasksPage />)} />
            <Route path="/whatsapp" element={withRouteBoundary(<WhatsAppIntegration />)} />
            <Route path="/instagram" element={withRouteBoundary(<InstagramIntegration />)} />
            <Route
              path="/workspace/:workspaceId/webhook"
              element={withRouteBoundary(<WebhookSources />)}
            />
            <Route
              path="/workspace/:workspaceId/sources"
              element={withRouteBoundary(<WorkspaceSources />)}
            />
            <Route
              path="/workspace/:workspaceId/sources/:sourceId"
              element={withRouteBoundary(<SourceDetailPage />)}
            />
            <Route path="/integrations/facebook" element={withRouteBoundary(<FacebookLeadAds />)} />
            <Route
              path="/workspace/:workspaceId/integrations/facebook"
              element={withRouteBoundary(<FacebookLeadAds />)}
            />
            <Route
              path="/workspace/:workspaceId/integrations/whatsapp"
              element={withRouteBoundary(<WhatsAppIntegration />)}
            />
            <Route path="/settings" element={withRouteBoundary(<WorkspaceSettings />)} />
            <Route path="/settings/mcp" element={withRouteBoundary(<McpSettingsPage />)} />
            <Route path="/mcp" element={withRouteBoundary(<McpSettingsPage />)} />
            <Route path="/account" element={withRouteBoundary(<Account />)} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    </ToastProvider>
  );
};

export default App;
