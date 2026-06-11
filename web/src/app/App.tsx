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
import { PresenterPage } from "../pages/PresenterPage";
import { ProjectionPage } from "../pages/ProjectionPage";
import { AdminUsersPage } from "../pages/AdminUsersPage";
import { Layout } from "../widgets/Layout";
import { Toaster } from "../shared/ui/sonner";

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
  if (user) return <Navigate to="/courses" replace />;
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

function PresenterRoute() {
  const { courseId, sessionId } = useParams();
  return <PresenterPage courseId={courseId ?? ""} sessionId={sessionId ?? ""} />;
}

function ProjectionRoute() {
  const { courseId, sessionId } = useParams();
  return <ProjectionPage courseId={courseId ?? ""} sessionId={sessionId ?? ""} />;
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
    element: <ProtectedLayout />,
    children: [
      { index: true, element: <Navigate to="/courses" replace /> },
      { path: "/courses", element: <CoursesPage /> },
      { path: "/courses/:courseId", element: <CourseRoute /> },
      { path: "/courses/:courseId/materials", element: <MaterialsRoute /> },
      { path: "/courses/:courseId/sessions/:sessionId/presenter", element: <PresenterRoute /> },
      { path: "/courses/:courseId/sessions/:sessionId/projection", element: <ProjectionRoute /> },
      { path: "/admin/users", element: <AdminUsersPage /> }
    ]
  },
  { path: "*", element: <Navigate to="/courses" replace /> }
]);

export function App() {
  return (
    <AuthProvider>
      <RouterProvider router={router} />
      <Toaster richColors closeButton />
    </AuthProvider>
  );
}
