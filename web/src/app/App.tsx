import { useEffect, useState } from "react";
import { AuthProvider, useAuth } from "./AuthContext";
import { LoginPage } from "../pages/LoginPage";
import { RegisterPage } from "../pages/RegisterPage";
import { CoursesPage } from "../pages/CoursesPage";
import { CoursePage } from "../pages/CoursePage";
import { AdminUsersPage } from "../pages/AdminUsersPage";
import { Layout } from "../widgets/Layout";

type Route =
  | { page: "login" }
  | { page: "register"; code: string }
  | { page: "courses" }
  | { page: "course"; courseId: string }
  | { page: "admin-users" };

function parseRoute(): Route {
  const hash = window.location.hash.replace(/^#\/?/, "") || "courses";
  if (hash.startsWith("login")) return { page: "login" };
  if (hash.startsWith("register")) {
    const code = new URLSearchParams(hash.split("?")[1] ?? "").get("code") ?? "";
    return { page: "register", code };
  }
  if (hash.startsWith("admin/users")) return { page: "admin-users" };
  const courseMatch = /^courses\/([0-9a-f-]{36})/.exec(hash);
  if (courseMatch) return { page: "course", courseId: courseMatch[1] };
  return { page: "courses" };
}

function Router() {
  const { user, loading } = useAuth();
  const [route, setRoute] = useState<Route>(parseRoute);

  useEffect(() => {
    const handler = () => setRoute(parseRoute());
    window.addEventListener("hashchange", handler);
    return () => window.removeEventListener("hashchange", handler);
  }, []);

  if (loading) {
    return (
      <div className="auth-shell">
        <div className="muted" style={{ textAlign: "center" }}>
          …
        </div>
      </div>
    );
  }

  if (!user && route.page !== "login" && route.page !== "register") {
    window.location.hash = "#/login";
    return null;
  }

  if (route.page === "login") return <LoginPage />;
  if (route.page === "register") return <RegisterPage code={route.code} />;

  return (
    <Layout>
      {route.page === "courses" && <CoursesPage />}
      {route.page === "course" && <CoursePage courseId={route.courseId} />}
      {route.page === "admin-users" && <AdminUsersPage />}
    </Layout>
  );
}

export function App() {
  return (
    <AuthProvider>
      <Router />
    </AuthProvider>
  );
}
