import { Suspense, lazy, type ReactNode } from "react";
import { Switch, Route, Router as WouterRouter, Redirect, useLocation } from "wouter";
import { QueryClient, QueryClientProvider, MutationCache, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { DirectionProvider } from "@radix-ui/react-direction";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as SonnerToaster } from "@/components/ui/sonner";
import { toast } from "sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AppLayout } from "@/components/layout";
import { RouteErrorBoundary } from "@/components/route-error-boundary";
import { OfflineIndicator } from "@/components/offline-indicator";
import { PwaUpdatePrompt } from "@/components/pwa-update-prompt";
import { SyncProvider } from "@/contexts/sync-context";
import { LanguageProvider, useLanguage } from "@/contexts/language-context";
import { LocationProvider } from "@/contexts/location-context";
import { isOfflineQueuedError, isOfflineBlockedError } from "@/lib/offline/fetch-interceptor";
import { SocketProvider } from "@/lib/socket";
import {
  establishAuthenticatedSession,
  getAuthenticatedSessionSnapshot,
  invalidateAuthenticatedSession,
} from "@/lib/authenticated-session";
import { FILE_ARCHIVE_PATH, legacyFileArchiveRedirect } from "@/lib/file-archive-route";

/* ── Lazy-loaded pages (code splitting) ─────────────────────────────── */
const Dashboard        = lazy(() => import("@/pages/dashboard"));
const Projects         = lazy(() => import("@/pages/projects"));
const ProjectDetail    = lazy(() => import("@/pages/project-detail"));
const States           = lazy(() => import("@/pages/states"));
const StateDetail      = lazy(() => import("@/pages/state-detail"));
const Budget           = lazy(() => import("@/pages/budget"));
const Reports          = lazy(() => import("@/pages/reports"));
const ReportsLanding   = lazy(() => import("@/pages/reports").then(m => ({ default: m.ReportsLanding })));
const Risks            = lazy(() => import("@/pages/risks"));
const AuditLog         = lazy(() => import("@/pages/audit-log"));
const UsersPage        = lazy(() => import("@/pages/users"));
const Plans            = lazy(() => import("@/pages/plans"));
const PlanDetail       = lazy(() => import("@/pages/plan-detail"));
const NotFound         = lazy(() => import("@/pages/not-found"));
const AccessDenied     = lazy(() => import("@/pages/access-denied"));
const LoginPage        = lazy(() => import("@/pages/login"));
const InviteAcceptPage = lazy(() => import("@/pages/invite-accept"));
const ForgotPasswordPage = lazy(() => import("@/pages/forgot-password"));
const ResetPasswordPage  = lazy(() => import("@/pages/reset-password"));
const VerifyEmailPage           = lazy(() => import("@/pages/verify-email"));
const EmailVerificationSentPage = lazy(() => import("@/pages/email-verification-sent"));
const PasswordResetSentPage     = lazy(() => import("@/pages/password-reset-sent"));
const Messages         = lazy(() => import("@/pages/messages"));
const ManualHome          = lazy(() => import("@/pages/manual"));
const ManualChapter       = lazy(() => import("@/pages/manual-chapter"));
const ManualFaqPage       = lazy(() => import("@/pages/manual-faq"));
const ManualRoleGuide     = lazy(() => import("@/pages/manual-role-guide"));
const CertificateVerify   = lazy(() => import("@/pages/certificate-verify"));
const NotificationsPage = lazy(() => import("@/pages/notifications"));
const ProfilePage      = lazy(() => import("@/pages/profile"));
const SyncStatusPage   = lazy(() => import("@/pages/sync-status"));
const FilesPage        = lazy(() => import("@/pages/files"));
const AiPage           = lazy(() => import("@/pages/ai"));
const NotificationPreferencesPage = lazy(() => import("@/pages/notification-preferences"));
const LandingPage          = lazy(() => import("@/pages/landing"));

export const appQueryClient = new QueryClient({
  mutationCache: new MutationCache({
    onError: (error) => {
      if (isOfflineQueuedError(error)) {
        toast.info("Action saved offline — will sync when connected", {
          id: "offline-queued",
          duration: 4000,
        });
      } else if (isOfflineBlockedError(error)) {
        // An explicit, non-success outcome prevents sensitive actions from
        // looking like they were saved while the browser was offline.
        toast.error("Internet Connection Required", {
          id: "offline-blocked",
          duration: 5000,
          description: `${error.actionDescription}. Please reconnect and try again.`,
        });
      }
    },
  }),
  defaultOptions: {
    queries: {
      // "always" lets our fetch interceptor serve from Dexie cache even when
      // navigator.onLine === false. Without this TanStack Query pauses all
      // queries offline and the cached data never shows.
      networkMode: "always",
      retry: (failureCount, error) => {
        // Never retry offline errors — they're intentional, not transient.
        if (isOfflineQueuedError(error)) return false;
        if (isOfflineBlockedError(error)) return false;
        return failureCount < 1;
      },
      refetchOnWindowFocus: false,
      // Keep data alive in memory for 30 min so page revisits don't refetch
      gcTime: 30 * 60 * 1000,
    },
    mutations: {
      networkMode: "always",
    },
  },
});

function PageLoader() {
  return (
    <div className="flex items-center justify-center min-h-[40vh]">
      <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
    </div>
  );
}

// Route guard: redirects to /access-denied if the authenticated user lacks `perm`.
// Reads directly from the TanStack Query cache (no network request, no queryFn needed).
// Router only mounts after AuthGate confirms auth data, so the cache is always populated.
// During a mid-refetch the AuthGate query is still alive and the cache entry is present,
// so we never get an empty permissions array from a stale refetch.
function ProtectedRoute({ perm, children }: { perm: string; children: ReactNode }) {
  const qc = useQueryClient();
  const data = qc.getQueryData<{ user?: { role?: string }; permissions?: string[] }>(["auth", "me"]);

  // Defensive: if for any reason the cache is empty, show a spinner rather than wrongly denying.
  if (!data) {
    return (
      <div className="flex items-center justify-center min-h-[40vh]">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const perms: string[] = data.permissions ?? [];
  const allowed = perms.includes("*") || perms.includes(perm);
  if (!allowed) return <Redirect to="/access-denied" />;
  return <>{children}</>;
}

function LegacyFilesRedirect({ source }: { source?: "resource" }) {
  // Wouter's location value is pathname-only, so read the browser query string
  // directly to preserve the explicitly safe list context during compatibility redirects.
  return <Redirect to={legacyFileArchiveRedirect(
    typeof window === "undefined" ? "" : window.location.search,
    source,
  )} />;
}

function Router() {
  const [location] = useLocation();
  return (
    <AppLayout>
      <RouteErrorBoundary key={location}>
      <Suspense fallback={<PageLoader />}>
        <Switch>
          <Route path="/"><Redirect to="/dashboard" /></Route>
          <Route path="/dashboard" component={Dashboard} />
          <Route path="/projects" component={Projects} />
          <Route path="/projects/:projectId" component={ProjectDetail} />
          <Route path="/states" component={States} />
          <Route path="/states/:stateId" component={StateDetail} />
          <Route path="/budget">{() => <ProtectedRoute perm="budget.view"><Budget /></ProtectedRoute>}</Route>
          <Route path="/reports" component={ReportsLanding} />
          <Route path="/reports/project">{() => <Reports lockedType="project" />}</Route>
          <Route path="/reports/activity">{() => <Reports lockedType="activity" />}</Route>
          <Route path="/reports/hq-sector">{() => <Reports lockedType="hq_sector" />}</Route>
          <Route path="/reports/program-state">{() => <Reports lockedType="program_state" />}</Route>
          <Route path="/risks" component={Risks} />
          {/* /planning and /planning-dashboard redirect to the Plans workspace */}
          <Route path="/planning"><Redirect to="/plans" /></Route>
          <Route path="/planning-dashboard"><Redirect to="/plans" /></Route>
          <Route path="/plans">{() => <Plans />}</Route>
          <Route path="/plans/:planId">{(params) => <PlanDetail planId={params.planId} />}</Route>
          <Route path="/messages" component={Messages} />
          <Route path="/messages/:conversationId" component={Messages} />
          <Route path="/manual" component={ManualHome} />
          <Route path="/manual/faq" component={ManualFaqPage} />
          <Route path="/manual/guides/:role">{(params) => <ManualRoleGuide role={params.role} />}</Route>
          <Route path="/manual/certificate/:certId">{(params) => <CertificateVerify certId={params.certId} />}</Route>
          <Route path="/manual/:slug">{(params) => <ManualChapter slug={params.slug} />}</Route>
          <Route path="/notifications" component={NotificationsPage} />
          <Route path="/access-denied" component={AccessDenied} />
          <Route path="/audit-log">{() => <ProtectedRoute perm="audit.view"><AuditLog /></ProtectedRoute>}</Route>
          <Route path="/users">{() => <ProtectedRoute perm="users.view"><UsersPage /></ProtectedRoute>}</Route>
          <Route path="/profile" component={ProfilePage} />
          <Route path="/notification-preferences" component={NotificationPreferencesPage} />
          <Route path="/sync-status" component={SyncStatusPage} />
          <Route path="/document-management/file-archive" component={FilesPage} />
          <Route path="/document-management"><Redirect to={FILE_ARCHIVE_PATH} /></Route>
          <Route path="/files"><LegacyFilesRedirect /></Route>
          <Route path="/drive"><LegacyFilesRedirect /></Route>
          <Route path="/program-resources"><LegacyFilesRedirect source="resource" /></Route>
          <Route path="/ai"><AiPage /></Route>
          {/* Keep saved settings bookmarks safe while moving everyone to the unified AI page. */}
          <Route path="/ai-settings"><Redirect to="/ai" /></Route>
          <Route component={NotFound} />
        </Switch>
      </Suspense>
      </RouteErrorBoundary>
    </AppLayout>
  );
}

function AuthGate() {
  const [location] = useLocation();
  const qc = useQueryClient();
  const { data, isLoading, isError } = useQuery({
    queryKey: ["auth", "me"],
    queryFn: async () => {
      const res = await fetch("/api/me", { credentials: "include" });
      if (res.status === 401) {
        invalidateAuthenticatedSession();
        qc.setQueryData(["/api/me"], null);
        return null;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const next = await res.json();
      establishAuthenticatedSession(next.user.id);
      // Seed generated identity consumers from the authoritative session
      // decision so mounting the staff shell does not issue a duplicate guard.
      qc.setQueryData(["/api/me"], next);
      return next;
    },
    retry: false,
    staleTime: 60_000,
  });

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (isError || !data) {
    // Public landing page at /
    if (location === "/") {
      return (
        <Suspense fallback={<div className="min-h-screen flex items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>}>
          <LandingPage />
        </Suspense>
      );
    }
    // All other unauthenticated paths → send to login
    return <Redirect to="/login" />;
  }
  // Remounting the socket provider by authenticated user ensures a logout or
  // development role switch cannot retain another recipient's realtime room.
  return (
    <SocketProvider
      key={`${data.user.id}:${getAuthenticatedSessionSnapshot().generation}`}
      userId={data.user.id}
    >
      <LocationProvider>
        <SyncProvider userId={data.user.id}>
          <Router />
          <OfflineIndicator />
        </SyncProvider>
      </LocationProvider>
    </SocketProvider>
  );
}

// ── Radix DirectionProvider bridge ───────────────────────────────────────
// Radix portal-based components (Dialog, Popover, Select, DropdownMenu, etc.)
// escape the DOM tree — they need an explicit DirectionProvider to receive
// the current text direction. This wrapper reads from LanguageContext, which
// must already be mounted above it.
function RadixDirectionBridge({ children }: { children: ReactNode }) {
  const { direction } = useLanguage();
  return <DirectionProvider dir={direction}>{children}</DirectionProvider>;
}

function App() {
  return (
    <QueryClientProvider client={appQueryClient}>
      <LanguageProvider>
        <RadixDirectionBridge>
          <TooltipProvider>
            <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
              <Suspense fallback={<div className="min-h-screen flex items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>}>
                <Switch>
                  <Route path="/login" component={LoginPage} />
                  <Route path="/invite/:token" component={InviteAcceptPage} />
                  <Route path="/accept-invitation" component={InviteAcceptPage} />
                  <Route path="/forgot-password" component={ForgotPasswordPage} />
                  <Route path="/reset-password" component={ResetPasswordPage} />
                  <Route path="/password-reset-sent" component={PasswordResetSentPage} />
                  <Route path="/verify-email" component={VerifyEmailPage} />
                  <Route path="/email-verification-sent" component={EmailVerificationSentPage} />
                  <Route><AuthGate /></Route>
                </Switch>
              </Suspense>
            </WouterRouter>
            <PwaUpdatePrompt />
            <Toaster />
            <SonnerToaster />
          </TooltipProvider>
        </RadixDirectionBridge>
      </LanguageProvider>
    </QueryClientProvider>
  );
}

export default App;
