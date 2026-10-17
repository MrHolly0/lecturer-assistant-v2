import type { ReactNode } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { BookOpen, Home, Link2, LogOut, Menu, Shield, UserRound, Users, X } from "lucide-react";
import { Link, NavLink, useNavigate } from "react-router-dom";
import { useAuth } from "../app/AuthContext";
import { landingPath } from "../app/routes";
import { BrandMark } from "../shared/brand/BrandMark";
import { Button, IconButton } from "../shared/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "../shared/ui/tooltip";
import { ThemeToggle } from "./ThemeToggle";

const navItems = [
  { path: "/home", icon: Home, label: "Главная", roles: ["STUDENT"] },
  { path: "/courses", icon: BookOpen, label: "Курсы", roles: ["ADMIN", "LECTURER", "ASSISTANT"] },
  {
    path: "/organization",
    icon: Users,
    label: "Сотрудники",
    roles: ["ADMIN", "LECTURER", "ASSISTANT"]
  },
  {
    path: "/settings/max",
    icon: Link2,
    label: "MAX и вход",
    roles: ["ADMIN", "LECTURER", "ASSISTANT"]
  },
  { path: "/admin/users", icon: Shield, label: "Учётные записи", roles: ["ADMIN"] }
];

export function Layout({ children }: { children: ReactNode }) {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(() =>
    typeof window !== "undefined" ? window.matchMedia("(max-width: 1023px)").matches : false
  );
  const openButtonRef = useRef<HTMLButtonElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const sidebarRef = useRef<HTMLElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  const closeSidebarAndRestoreFocus = useCallback(() => {
    setSidebarOpen(false);
    requestAnimationFrame(() => openButtonRef.current?.focus());
  }, []);

  useEffect(() => {
    const media = window.matchMedia("(max-width: 1023px)");
    const updateViewport = () => {
      setIsMobile(media.matches);
      if (!media.matches) setSidebarOpen(false);
    };
    updateViewport();
    media.addEventListener("change", updateViewport);
    return () => media.removeEventListener("change", updateViewport);
  }, []);

  useEffect(() => {
    if (!isMobile || !sidebarOpen) return undefined;
    closeButtonRef.current?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeSidebarAndRestoreFocus();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = sidebarRef.current?.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])'
      );
      if (!focusable?.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [closeSidebarAndRestoreFocus, isMobile, sidebarOpen]);

  useEffect(() => {
    const content = contentRef.current;
    if (!content) return;
    content.inert = isMobile && sidebarOpen;
    if (isMobile && sidebarOpen) content.setAttribute("aria-hidden", "true");
    else content.removeAttribute("aria-hidden");
    return () => {
      content.inert = false;
      content.removeAttribute("aria-hidden");
    };
  }, [isMobile, sidebarOpen]);

  async function handleSignOut() {
    await signOut();
    navigate("/login", { replace: true });
  }

  return (
    <div className="flex h-screen bg-background text-foreground">
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-20 bg-black/40 lg:hidden"
          aria-hidden="true"
          onClick={closeSidebarAndRestoreFocus}
        />
      )}

      {(!isMobile || sidebarOpen) && (
        <aside
          ref={sidebarRef}
          id="primary-navigation"
          aria-label="Основное меню"
          className={`fixed z-30 flex h-full w-64 flex-col overflow-y-auto border-r border-border bg-card text-card-foreground transition-transform duration-200 lg:static ${
            sidebarOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"
          }`}
        >
          <div className="flex items-center justify-between border-b border-border p-5">
            <Link
              to={user ? landingPath(user.role) : "/login"}
              className="flex min-w-0 items-center gap-2.5 text-sm font-semibold"
            >
              <BrandMark className="h-8 w-8 shrink-0 text-orange-500" />
              <span className="truncate">Lecturer Assistant</span>
            </Link>
            <IconButton
              ref={closeButtonRef}
              className="icon-touch-target layout-sidebar-close shrink-0"
              onClick={closeSidebarAndRestoreFocus}
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
                          `mb-1 flex min-h-11 items-center gap-3 rounded-md px-3 text-sm transition-colors ${
                            isActive
                              ? "bg-accent font-semibold text-accent-foreground"
                              : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                          }`
                        }
                      >
                        <Icon className="h-4 w-4" aria-hidden="true" />
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
            <ThemeToggle />
            <div className="mb-2 flex items-center gap-3 px-3 py-2 text-sm text-muted-foreground">
              <UserRound className="h-4 w-4 shrink-0" />
              <span className="min-w-0">
                <span className="block truncate text-foreground">{user?.displayName}</span>
                <span className="block truncate text-xs" title={user?.email}>
                  {user?.email}
                </span>
              </span>
            </div>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  onClick={() => void handleSignOut()}
                  variant="ghost"
                  className="w-full justify-start text-muted-foreground"
                >
                  <LogOut className="h-4 w-4" />
                  <span>Выйти</span>
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p>Завершить сессию</p>
              </TooltipContent>
            </Tooltip>
          </div>
        </aside>
      )}

      <div ref={contentRef} className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-3 border-b border-border bg-card px-4 py-3 text-card-foreground lg:hidden">
          <IconButton
            ref={openButtonRef}
            className="icon-touch-target shrink-0"
            onClick={() => setSidebarOpen(true)}
            aria-expanded={sidebarOpen}
            aria-controls={!isMobile || sidebarOpen ? "primary-navigation" : undefined}
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
