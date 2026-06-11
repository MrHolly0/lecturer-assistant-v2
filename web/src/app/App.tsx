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
import { AdminUsersPage } from "../pages/AdminUsersPage";
import { Layout } from "../widgets/Layout";

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
      { path: "/admin/users", element: <AdminUsersPage /> }
    ]
  },
  { path: "*", element: <Navigate to="/courses" replace /> }
]);

export function App() {
  return (
    <AuthProvider>
      <RouterProvider router={router} />
    </AuthProvider>
  );
}
