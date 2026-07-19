import { Suspense, lazy } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import { AppLayout } from "@/components/layout/AppLayout";
import { useAuth } from "@/hooks/useAuth";
import { Skeleton } from "@/components/ui/skeleton";

const LoginPage = lazy(() => import("@/pages/LoginPage"));
const DashboardPage = lazy(() => import("@/pages/DashboardPage"));
const NewMeetingPage = lazy(() => import("@/pages/NewMeetingPage"));
const LiveMeetingPage = lazy(() => import("@/pages/LiveMeetingPage"));
const EditorPage = lazy(() => import("@/pages/EditorPage"));
const TemplatesPage = lazy(() => import("@/pages/TemplatesPage"));
const ExportsPage = lazy(() => import("@/pages/ExportsPage"));

function PageFallback() {
  return (
    <div className="space-y-4 p-8">
      <Skeleton className="h-8 w-64" />
      <Skeleton className="h-40 w-full" />
      <Skeleton className="h-40 w-full" />
    </div>
  );
}

function Protected({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <PageFallback />;
  if (!user) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

export default function App() {
  const location = useLocation();
  return (
    <Suspense fallback={<PageFallback />}>
      <AnimatePresence mode="wait">
        <Routes location={location} key={location.pathname}>
          <Route path="/login" element={<LoginPage />} />
          <Route
            element={
              <Protected>
                <AppLayout />
              </Protected>
            }
          >
            <Route
              path="/"
              element={
                <PageTransition>
                  <DashboardPage />
                </PageTransition>
              }
            />
            <Route
              path="/new"
              element={
                <PageTransition>
                  <NewMeetingPage />
                </PageTransition>
              }
            />
            <Route
              path="/live"
              element={
                <PageTransition>
                  <LiveMeetingPage />
                </PageTransition>
              }
            />
            <Route
              path="/meetings/:id"
              element={
                <PageTransition>
                  <EditorPage />
                </PageTransition>
              }
            />
            <Route
              path="/templates"
              element={
                <PageTransition>
                  <TemplatesPage />
                </PageTransition>
              }
            />
            <Route
              path="/exports"
              element={
                <PageTransition>
                  <ExportsPage />
                </PageTransition>
              }
            />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AnimatePresence>
    </Suspense>
  );
}

function PageTransition({ children }: { children: React.ReactNode }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ duration: 0.18 }}
    >
      {children}
    </motion.div>
  );
}
