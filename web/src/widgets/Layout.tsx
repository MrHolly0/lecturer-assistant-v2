import type { ReactNode } from "react";
import { useState } from "react";
import { BookOpen, Home, Link2, LogOut, Menu, Shield, UserRound, X } from "lucide-react";
import { Link, NavLink, useNavigate } from "react-router-dom";
import { useAuth } from "../app/AuthContext";
import { landingPath } from "../app/routes";
import { BrandMark } from "../shared/brand/BrandMark";
import { IconButton } from "../shared/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "../shared/ui/tooltip";

const navItems = [
  { path: "/home", icon: Home, label: "Главная", roles: ["STUDENT"] },
  { path: "/courses", icon: BookOpen, label: "Курсы", roles: ["ADMIN", "LECTURER", "ASSISTANT"] },
  {
    path: "/settings/max",
    icon: Link2,
    label: "Подключить MAX",
    roles: ["ADMIN", "LECTURER", "ASSISTANT"]
  },
  { path: "/admin/users", icon: Shield, label: "Пользователи", roles: ["ADMIN"] }
];

export function Layout({ children }: { children: ReactNode }) {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  async function handleSignOut() {
    await signOut();
    navigate("/login", { replace: true });
  }

  return (
    <div className="flex h-screen bg-background text-foreground">
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/40 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      <aside
        className={`fixed z-50 flex h-full w-[220px] flex-col border-r border-border bg-card text-card-foreground transition-transform duration-200 lg:static ${
          sidebarOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"
        }`}
      >
        <div className="flex items-center justify-between border-b border-border p-5">
          <Link
            to={user ? landingPath(user.role) : "/login"}
            className="flex items-center gap-2 text-base font-semibold"
          >
            <BrandMark className="h-8 w-8 shrink-0 text-orange-500" />
            <span>Lecturer Assistant</span>
          </Link>
          <IconButton
            className="icon-touch-target shrink-0 lg:hidden"
            onClick={() => setSidebarOpen(false)}
            label="Закрыть меню"
          >
            <X className="h-5 w-5" />
          </IconButton>
        </div>

        <nav className="flex-1 p-3">
          {navItems
            .filter((item) => user && item.roles.includes(user.role))
            .map((item) => {
              const Icon = item.icon;
              return (
                <Tooltip key={item.path}>
                  <TooltipTrigger asChild>
                    <NavLink
                      to={item.path}
                      onClick={() => setSidebarOpen(false)}
                      className={({ isActive }) =>
                        `mb-0.5 flex items-center gap-3 rounded-lg px-4 py-2.5 text-sm transition-colors ${
                          isActive
                            ? "border border-border border-l-[3px] border-l-foreground bg-accent font-semibold text-accent-foreground"
                            : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                        }`
                      }
                    >
                      <Icon className="h-4 w-4" />
                      <span>{item.label}</span>
                    </NavLink>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>{item.label}</p>
                  </TooltipContent>
                </Tooltip>
              );
            })}
        </nav>

        <div className="border-t border-border p-3">
          <div className="mb-2 flex items-center gap-3 rounded-lg px-4 py-2 text-sm text-muted-foreground">
            <UserRound className="h-4 w-4" />
            <span className="truncate" title={user?.email}>
              {user?.displayName}
            </span>
          </div>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={() => void handleSignOut()}
                className="flex w-full cursor-pointer items-center gap-3 rounded-lg px-4 py-2.5 text-sm font-normal text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
              >
                <LogOut className="h-4 w-4" />
                <span>Выйти</span>
              </button>
            </TooltipTrigger>
            <TooltipContent>
              <p>Завершить сессию</p>
            </TooltipContent>
          </Tooltip>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-3 border-b border-border bg-card px-4 py-3 text-card-foreground lg:hidden">
          <IconButton
            className="icon-touch-target shrink-0"
            onClick={() => setSidebarOpen(true)}
            label="Открыть меню"
          >
            <Menu className="h-5 w-5" />
          </IconButton>
          <BrandMark className="h-6 w-6 text-orange-500" />
          <span className="text-sm font-medium">Lecturer Assistant</span>
        </div>
        <main className="flex-1 overflow-auto">{children}</main>
      </div>
    </div>
  );
}
