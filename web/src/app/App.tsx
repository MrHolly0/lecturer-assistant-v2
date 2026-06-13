import {
  createHashRouter,
  Navigate,
  Outlet,
  RouterProvider,
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

function LoadingScreen() {
  return (
    <div className="auth-shell">
      <div className="muted" style={{ textAlign: "center" }}>
        …
      </div>
    </div>
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
]);

export function App() {
  return (
    <AuthProvider>
      <RouterProvider router={router} />
      <Toaster richColors closeButton />
    </AuthProvider>
  );
}
