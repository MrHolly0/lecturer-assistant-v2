import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
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
import { MaxLinkPage } from "../pages/MaxLinkPage";
import { CourseAnalyticsPage } from "../pages/CourseAnalyticsPage";
import { SessionSummaryPage } from "../pages/SessionSummaryPage";
import { TeacherRemotePage } from "../pages/TeacherRemotePage";
import { Layout } from "../widgets/Layout";
import { Toaster } from "../shared/ui/sonner";
import { landingPath, type UserRole } from "./routes";
import { hideBackButton, showBackButton, subscribeBackButton } from "./max/bridge";
import { useMaxBridge } from "./max/context";
import { readMaxLinkCode } from "./max/deepLink";
import { canRedirectToTeacherRemote, isMobileMax, teacherRemotePath } from "./max/navigation";
import { getLiveSession, getMyActiveSession } from "./api/live-api";
import { getMyStudentActiveSession } from "./api/student-api";
import { readStudentResume } from "./studentResume";
import { MaxLinkCodeScreen } from "../widgets/MaxLinkCodeScreen";
import { MaxCredentialsScreen } from "../widgets/MaxCredentialsScreen";
import { RoleHomeRoute } from "../widgets/RoleHomeRoute";
import { Button } from "../shared/ui/button";

const maxRootPaths = new Set(["/", "/home", "/courses", "/login", "/register"]);
const maxStartParamPattern = /^[A-Za-z0-9_-]{1,512}$/;

function MaxNavigationRoot() {
  const maxEnvironment = useMaxBridge();
  const { isMax, startParam } = maxEnvironment;
  const {
    loading,
    maxAuthError,
    maxSignedOut,
    maxLinkRequired,
    maxCredentialsRequired,
    loginAndLinkMax,
    registerAndLinkMax,
    submitMaxLinkCode,
    continueMaxAuth,
    retryMaxAuth,
    resumeMaxAuth,
    chooseMaxLinkCode,
    chooseMaxCredentials,
    user
  } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [startParamHandled, setStartParamHandled] = useState(false);
  const mobileMax = isMobileMax(maxEnvironment);
  const teacherInMax = Boolean(user && user.role !== "STUDENT" && mobileMax);
  const studentInMax = Boolean(isMax && user?.role === "STUDENT");
  const activeSession = useQuery({
    queryKey: ["active-session"],
    queryFn: getMyActiveSession,
    enabled: teacherInMax,
    retry: 1,
    staleTime: 1000,
    refetchInterval: 5000
  });
  const remotePath = activeSession.data
    ? teacherRemotePath(activeSession.data.courseId, activeSession.data.sessionId)
    : null;
  const studentActiveSession = useQuery({
    queryKey: ["student-active-session"],
    queryFn: getMyStudentActiveSession,
    enabled: studentInMax,
    retry: 1
  });
  const storedStudentSession = readStudentResume();
  const startTarget =
    user?.role === "STUDENT" && startParam && maxStartParamPattern.test(startParam)
      ? `/s/${encodeURIComponent(startParam.toUpperCase())}`
      : null;

  useEffect(() => {
    const shouldShowBackButton =
      isMax && !maxRootPaths.has(location.pathname) && !location.pathname.endsWith("/remote");
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

  if (location.pathname.startsWith("/projection/")) return <Outlet />;
  if (isMax && loading) return <LoadingScreen message="Входим через MAX…" />;
  if (isMax && maxSignedOut) {
    return (
      <MaxSignedOutScreen
        onLogin={resumeMaxAuth}
        onCode={chooseMaxLinkCode}
        onCredentials={chooseMaxCredentials}
      />
    );
  }
  if (isMax && maxLinkRequired) {
    return (
      <MaxLinkCodeScreen
        initialCode={readMaxLinkCode(startParam) ?? ""}
        error={maxAuthError}
        onSubmit={submitMaxLinkCode}
        onContinue={continueMaxAuth}
        onCredentials={chooseMaxCredentials}
      />
    );
  }
  if (isMax && maxCredentialsRequired) {
    return (
      <MaxCredentialsScreen
        onLogin={loginAndLinkMax}
        onRegister={registerAndLinkMax}
        onStudent={continueMaxAuth}
        onCode={chooseMaxLinkCode}
      />
    );
  }
  if (isMax && !user) {
    return (
      <MaxAuthScreen
        error={maxAuthError}
        onRetry={retryMaxAuth}
        onCode={chooseMaxLinkCode}
        onCredentials={chooseMaxCredentials}
      />
    );
  }
  if (isMax && !startParamHandled && startTarget && location.pathname !== startTarget) {
    return <Navigate to={startTarget} replace />;
  }
  if (
    studentInMax &&
    !startTarget &&
    (location.pathname === "/" || location.pathname === "/login" || location.pathname === "/home")
  ) {
    if (studentActiveSession.isLoading) return <LoadingScreen message="Ищем вашу лекцию…" />;
    const joinCode = studentActiveSession.data?.joinCode ?? storedStudentSession?.joinCode;
    if (joinCode) {
      return <Navigate to={`/s/${encodeURIComponent(joinCode)}`} replace />;
    }
  }
  if (!isMax && !user && storedStudentSession && location.pathname === "/") {
    return <Navigate to={`/s/${encodeURIComponent(storedStudentSession.joinCode)}`} replace />;
  }
  if (teacherInMax && activeSession.isLoading && canRedirectToTeacherRemote(location.pathname)) {
    return <LoadingScreen message="Ищем активную лекцию…" />;
  }
  if (
    teacherInMax &&
    remotePath &&
    location.pathname !== remotePath &&
    canRedirectToTeacherRemote(location.pathname)
  ) {
    return <Navigate to={remotePath} replace />;
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

function MaxAuthScreen({
  error,
  onRetry,
  onCode,
  onCredentials
}: {
  error: string | null;
  onRetry: () => void;
  onCode: () => void;
  onCredentials: () => void;
}) {
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
        <Button className="max-auth-retry" type="button" onClick={onRetry}>
          Попробовать снова
        </Button>
        <Button type="button" variant="outline" onClick={onCode}>
          Войти по коду
        </Button>
        <Button type="button" variant="ghost" onClick={onCredentials}>
          Войти по email и паролю
        </Button>
      </section>
    </main>
  );
}

function MaxSignedOutScreen({
  onLogin,
  onCode,
  onCredentials
}: {
  onLogin: () => void;
  onCode: () => void;
  onCredentials: () => void;
}) {
  return (
    <main className="auth-shell">
      <section className="auth-card max-auth-card" aria-labelledby="max-signed-out-title">
        <div className="auth-header">
          <span className="max-auth-eyebrow">Мини-приложение MAX</span>
          <h1 className="auth-title" id="max-signed-out-title">
            Вы вышли из аккаунта
          </h1>
          <p className="auth-hint">
            Выберите аккаунт для входа. Код или пароль позволят перепривязать MAX к другой учётной
            записи.
          </p>
        </div>
        <Button className="max-auth-retry" type="button" onClick={onLogin}>
          Войти через MAX
        </Button>
        <Button type="button" variant="outline" onClick={onCode}>
          Войти по коду
        </Button>
        <Button type="button" variant="ghost" onClick={onCredentials}>
          Другой аккаунт по email и паролю
        </Button>
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

function CourseAnalyticsRoute() {
  const { courseId } = useParams();
  return <CourseAnalyticsPage courseId={courseId ?? ""} />;
}

function SessionSummaryRoute() {
  const { courseId, sessionId } = useParams();
  return <SessionSummaryPage courseId={courseId ?? ""} sessionId={sessionId ?? ""} />;
}

function PresenterRoute() {
  const { courseId, sessionId } = useParams();
  return <PresenterPage courseId={courseId ?? ""} sessionId={sessionId ?? ""} />;
}

function ProjectionRoute() {
  const { joinCode } = useParams();
  return <ProjectionPage joinCode={joinCode ?? ""} />;
}

function LegacyProjectionRoute() {
  const { courseId, sessionId } = useParams();
  const session = useQuery({
    queryKey: ["live", courseId, sessionId],
    queryFn: () => getLiveSession(courseId ?? "", sessionId ?? ""),
    enabled: Boolean(courseId && sessionId)
  });
  if (session.isLoading) return <LoadingScreen />;
  if (!session.data) return <LoadingScreen message="Не удалось открыть проектор" />;
  return <Navigate to={`/projection/${encodeURIComponent(session.data.joinCode)}`} replace />;
}

function SessionJoinRoute() {
  const { courseId, sessionId } = useParams();
  return <SessionJoinPage courseId={courseId ?? ""} sessionId={sessionId ?? ""} />;
}

function StudentSessionRoute() {
  const { joinCode } = useParams();
  return <StudentSessionPage joinCode={joinCode ?? ""} />;
}

function TeacherRemoteRoute() {
  const { courseId, sessionId } = useParams();
  return <TeacherRemotePage courseId={courseId ?? ""} sessionId={sessionId ?? ""} />;
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
        path: "/projection/:joinCode",
        element: <ProjectionRoute />
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
        path: "/courses/:courseId/sessions/:sessionId/remote",
        element: (
          <RequireRolePage roles={["ADMIN", "LECTURER", "ASSISTANT"]}>
            <TeacherRemoteRoute />
          </RequireRolePage>
        )
      },
      {
        path: "/courses/:courseId/sessions/:sessionId/projection",
        element: (
          <RequireRolePage roles={["ADMIN", "LECTURER", "ASSISTANT"]}>
            <LegacyProjectionRoute />
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
        path: "/courses/:courseId/sessions/:sessionId/summary",
        element: (
          <RequireRolePage roles={["ADMIN", "LECTURER", "ASSISTANT"]}>
            <SessionSummaryRoute />
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
          { index: true, element: <RoleHomeRoute /> },
          { path: "/home", element: <StudentHomePage /> },
          {
            element: <RequireRole roles={["ADMIN", "LECTURER", "ASSISTANT"]} />,
            children: [
              { path: "/courses", element: <CoursesPage /> },
              { path: "/courses/:courseId", element: <CourseRoute /> },
              { path: "/courses/:courseId/materials", element: <MaterialsRoute /> },
              { path: "/courses/:courseId/questions", element: <QuestionBankRoute /> },
              { path: "/courses/:courseId/analytics", element: <CourseAnalyticsRoute /> },
              { path: "/settings/max", element: <MaxLinkPage /> }
            ]
          },
          {
            element: <RequireRole roles={["ADMIN"]} />,
            children: [{ path: "/admin/users", element: <AdminUsersPage /> }]
          }
        ]
      },
      { path: "*", element: <RoleHomeRoute /> }
    ]
  }
]);

export function App() {
  const { theme } = useMaxBridge();

  return (
    <AuthProvider>
      <RouterProvider router={router} />
      <Toaster theme={theme} position="top-center" richColors />
    </AuthProvider>
  );
}
