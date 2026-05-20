import { lazy, Suspense } from 'react';
import { Routes, Route } from 'react-router-dom';
import { ErrorBoundary } from '@/components/ui/ErrorBoundary';
import { ToastProvider } from '@/components/ui/Toast';

// Public pages
const LandingPage = lazy(() => import('@/pages/LandingPage'));
const LoginPage = lazy(() => import('@/pages/LoginPage'));
const CreateAccountPage = lazy(() => import('@/pages/CreateAccountPage'));
const PrivacyPage = lazy(() => import('@/pages/PrivacyPage'));
const TermsPage = lazy(() => import('@/pages/TermsPage'));

// App pages
const AppPage = lazy(() => import('@/pages/app/AppPage'));
const CommunityPage = lazy(() => import('@/pages/app/CommunityPage'));
const ChannelPage = lazy(() => import('@/pages/app/ChannelPage'));
const DMPage = lazy(() => import('@/pages/app/DMPage'));
const SettingsPage = lazy(() => import('@/pages/app/SettingsPage'));
const VoidWallPage = lazy(() => import('@/pages/app/VoidWallPage'));
const BanWallPage = lazy(() => import('@/pages/app/BanWallPage'));

function LoadingFallback() {
  return (
    <div className="flex h-screen w-screen items-center justify-center bg-void-bg">
      <div className="flex flex-col items-center gap-3">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-void-fg/20 border-t-void-primary" />
        <span className="text-sm text-void-fg/50">Loading...</span>
      </div>
    </div>
  );
}

export function App() {
  return (
    <ErrorBoundary showDetails={import.meta.env.DEV}>
      <ToastProvider>
        <Suspense fallback={<LoadingFallback />}>
          <Routes>
            {/* Public routes */}
            <Route path="/" element={<LandingPage />} />
            <Route path="/login" element={<LoginPage />} />
            <Route path="/create" element={<CreateAccountPage />} />
            <Route path="/privacy" element={<PrivacyPage />} />
            <Route path="/terms" element={<TermsPage />} />

            {/* Authenticated app routes */}
            <Route path="/app" element={<AppPage />} />
            <Route path="/app/settings" element={<SettingsPage />} />
            <Route path="/app/community/:id" element={<CommunityPage />} />
            <Route path="/app/community/:id/channel/:channelId" element={<ChannelPage />} />
            <Route path="/app/dm/:recipientId" element={<DMPage />} />
            <Route path="/app/wall/:publicId" element={<VoidWallPage />} />
            <Route path="/app/bans" element={<BanWallPage />} />
          </Routes>
        </Suspense>
      </ToastProvider>
    </ErrorBoundary>
  );
}
