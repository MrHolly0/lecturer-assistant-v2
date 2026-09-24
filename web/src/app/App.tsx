import { useEffect, useState } from "react";
import {
  createHashRouter,
  Navigate,
  Outlet,
  RouterProvider,
  useLocation,
  useNavigate,
  useParams,
  useSearchParams
} from "react-router-dom";
import { AuthProvider, useAuth } from "./AuthContext";
import { LoginPage } from "../pages/LoginPage";
import { RegisterPage } from "../pages/RegisterPage";
import { CoursesPage } from "../pages/CoursesPage";
import { CoursePage } from "../pages/CoursePage";
import { MaterialsPage } from "../pages/MaterialsPage";
import { QuestionBankPage } from "../pages/QuestionBankPage";
import { PresenterPage } from "../pages/PresenterPage";
import { ProjectionPage } from "../pages/ProjectionPage";
import { SessionJoinPage } from "../pages/SessionJoinPage";
import { AdminUsersPage } from "../pages/AdminUsersPage";
import { StudentHomePage } from "../pages/StudentHomePage";
import { StudentSessionPage } from "../pages/StudentSessionPage";
import { Layout } from "../widgets/Layout";
import { Toaster } from "../shared/ui/sonner";
import { landingPath, type UserRole } from "./routes";
import { hideBackButton, showBackButton, subscribeBackButton } from "./max/bridge";
import { useMaxBridge } from "./max/context";

const maxRootPaths = new Set(["/", "/home", "/courses", "/login", "/register"]);
const maxStartParamPattern = /^[A-Za-z0-9_-]{1,512}$/;

function MaxNavigationRoot() {
  const { isMax, startParam } = useMaxBridge();
  const { loading, maxAuthError, retryMaxAuth, user } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [startParamHandled, setStartParamHandled] = useState(false);
  const startTarget =
    user?.role === "STUDENT" && startParam && maxStartParamPattern.test(startParam)
      ? `/s/${encodeURIComponent(startParam.toUpperCase())}`
      : null;

  useEffect(() => {
    const shouldShowBackButton = isMax && !maxRootPaths.has(location.pathname);
    if (!shouldShowBackButton) {
      hideBackButton();
      return;
    }

    const unsubscribe = subscribeBackButton(() => navigate(-1));
    showBackButton();

    return () => {
      unsubscribe();
      hideBackButton();
    };
  }, [isMax, location.pathname, navigate]);

  useEffect(() => {
    if (startParamHandled || !isMax || loading || !user) return;
    if (!startTarget || location.pathname === startTarget) setStartParamHandled(true);
  }, [isMax, loading, location.pathname, startParamHandled, startTarget, user]);

  if (isMax && loading) return <LoadingScreen message="Входим через MAX…" />;
  if (isMax && !user) {
    return <MaxAuthScreen error={maxAuthError} onRetry={retryMaxAuth} />;
  }
  if (isMax && !startParamHandled && startTarget && location.pathname !== startTarget) {
    return <Navigate to={startTarget} replace />;
  }

  return <Outlet />;
}

function LoadingScreen({ message = "Загрузка…" }: { message?: string }) {
  return (
    <div className="auth-shell" aria-busy="true" aria-live="polite">
      <div className="max-auth-status muted">{message}</div>
    </div>
  );
}

function MaxAuthScreen({ error, onRetry }: { error: string | null; onRetry: () => void }) {
  return (
    <main className="auth-shell">
      <section className="auth-card max-auth-card" aria-labelledby="max-auth-title">
        <div className="auth-header">
          <span className="max-auth-eyebrow">Мини-приложение MAX</span>
          <h1 className="auth-title" id="max-auth-title">
            Не удалось войти
          </h1>
        </div>
        <p className="form-error" role="alert">
          {error ?? "Повторите вход через MAX."}
        </p>
        <button className="btn-primary max-auth-retry" type="button" onClick={onRetry}>
          Попробовать снова
        </button>
      </section>
    </main>
  );
}

function PublicOnly({ children }: { children: JSX.Element }) {
  const { user, loading } = useAuth();
  if (loading) return <LoadingScreen />;
  if (user) return <Navigate to={landingPath(user.role)} replace />;
  return children;
}

function ProtectedLayout() {
  const { user, loading } = useAuth();
  if (loading) return <LoadingScreen />;
  if (!user) return <Navigate to="/login" replace />;

  return (
    <Layout>
      <Outlet />
    </Layout>
  );
}

function RequireRole({ roles }: { roles: UserRole[] }) {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  if (!roles.includes(user.role)) return <Navigate to={landingPath(user.role)} replace />;
  return <Outlet />;
}

function RequireRolePage({ roles, children }: { roles: UserRole[]; children: JSX.Element }) {
  const { user, loading } = useAuth();
  if (loading) return <LoadingScreen />;
  if (!user) return <Navigate to="/login" replace />;
  if (!roles.includes(user.role)) return <Navigate to={landingPath(user.role)} replace />;
  return children;
}

function RoleHome() {
  const { user } = useAuth();
  return <Navigate to={user ? landingPath(user.role) : "/login"} replace />;
}

function RegisterRoute() {
  const [searchParams] = useSearchParams();
  return <RegisterPage code={searchParams.get("code") ?? ""} />;
}

function CourseRoute() {
  const { courseId } = useParams();
  return <CoursePage courseId={courseId ?? ""} />;
}

function MaterialsRoute() {
  const { courseId } = useParams();
  return <MaterialsPage courseId={courseId ?? ""} />;
}

function QuestionBankRoute() {
  const { courseId } = useParams();
  return <QuestionBankPage courseId={courseId ?? ""} />;
}

function PresenterRoute() {
  const { courseId, sessionId } = useParams();
  return <PresenterPage courseId={courseId ?? ""} sessionId={sessionId ?? ""} />;
}

function ProjectionRoute() {
  const { courseId, sessionId } = useParams();
  return <ProjectionPage courseId={courseId ?? ""} sessionId={sessionId ?? ""} />;
}

function SessionJoinRoute() {
  const { courseId, sessionId } = useParams();
  return <SessionJoinPage courseId={courseId ?? ""} sessionId={sessionId ?? ""} />;
}

function StudentSessionRoute() {
  const { joinCode } = useParams();
  return <StudentSessionPage joinCode={joinCode ?? ""} />;
}

const router = createHashRouter([
  {
    element: <MaxNavigationRoot />,
    children: [
      {
        path: "/login",
        element: (
          <PublicOnly>
            <LoginPage />
          </PublicOnly>
        )
      },
      {
        path: "/register",
        element: (
          <PublicOnly>
            <RegisterRoute />
          </PublicOnly>
        )
      },
      {
        path: "/courses/:courseId/sessions/:sessionId/presenter",
        element: (
          <RequireRolePage roles={["ADMIN", "LECTURER", "ASSISTANT"]}>
            <PresenterRoute />
          </RequireRolePage>
        )
      },
      {
        path: "/courses/:courseId/sessions/:sessionId/projection",
        element: (
          <RequireRolePage roles={["ADMIN", "LECTURER", "ASSISTANT"]}>
            <ProjectionRoute />
          </RequireRolePage>
        )
      },
      {
        path: "/courses/:courseId/sessions/:sessionId/join",
        element: (
          <RequireRolePage roles={["ADMIN", "LECTURER", "ASSISTANT"]}>
            <SessionJoinRoute />
          </RequireRolePage>
        )
      },
      {
        path: "/s/:joinCode",
        element: <StudentSessionRoute />
      },
      {
        element: <ProtectedLayout />,
        children: [
          { index: true, element: <RoleHome /> },
          { path: "/home", element: <StudentHomePage /> },
          {
            element: <RequireRole roles={["ADMIN", "LECTURER", "ASSISTANT"]} />,
            children: [
              { path: "/courses", element: <CoursesPage /> },
              { path: "/courses/:courseId", element: <CourseRoute /> },
              { path: "/courses/:courseId/materials", element: <MaterialsRoute /> },
              { path: "/courses/:courseId/questions", element: <QuestionBankRoute /> }
            ]
          },
          {
            element: <RequireRole roles={["ADMIN"]} />,
            children: [{ path: "/admin/users", element: <AdminUsersPage /> }]
          }
        ]
      },
      { path: "*", element: <RoleHome /> }
    ]
  }
]);

export function App() {
  return (
    <AuthProvider>
      <RouterProvider router={router} />
      <Toaster position="top-center" richColors closeButton />
    </AuthProvider>
  );
}
