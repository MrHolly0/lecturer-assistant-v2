import type { ReactNode } from "react";
import { useState } from "react";
import { BookOpen, LogOut, Menu, Shield, UserRound, X } from "lucide-react";
import { useAuth } from "../app/AuthContext";
import { Tooltip, TooltipContent, TooltipTrigger } from "../shared/ui/tooltip";

const navItems = [
  { path: "#/courses", icon: BookOpen, label: "Курсы" },
  { path: "#/admin/users", icon: Shield, label: "Пользователи", adminOnly: true }
];

export function Layout({ children }: { children: ReactNode }) {
  const { user, signOut } = useAuth();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const hash = window.location.hash || "#/courses";

  return (
    <div className="flex h-screen bg-neutral-100">
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/40 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      <aside
        className={`fixed z-50 flex h-full w-[220px] flex-col border-r border-neutral-200 bg-white transition-transform duration-200 lg:static ${
          sidebarOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"
        }`}
      >
        <div className="flex items-center justify-between border-b border-neutral-200 p-5">
          <a href="#/courses" className="flex items-center gap-2 text-lg">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-orange-500 text-xs text-white">
              L
            </span>
            LectureApp
          </a>
          <button
            className="lg:hidden"
            onClick={() => setSidebarOpen(false)}
            aria-label="Закрыть меню"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <nav className="flex-1 p-3">
          {navItems
            .filter((item) => !item.adminOnly || user?.role === "ADMIN")
            .map((item) => {
              const Icon = item.icon;
              const active = hash.startsWith(item.path);
              return (
                <Tooltip key={item.path}>
                  <TooltipTrigger asChild>
                    <a
                      href={item.path}
                      onClick={() => setSidebarOpen(false)}
                      className={`mb-0.5 flex items-center gap-3 rounded-lg px-4 py-2.5 text-sm transition-colors ${
                        active
                          ? "border border-orange-200 bg-orange-50 text-orange-600"
                          : "text-neutral-600 hover:bg-neutral-100"
                      }`}
                    >
                      <Icon className="h-4 w-4" />
                      <span>{item.label}</span>
                    </a>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>{item.label}</p>
                  </TooltipContent>
                </Tooltip>
              );
            })}
        </nav>

        <div className="border-t border-neutral-200 p-3">
          <div className="mb-2 flex items-center gap-3 rounded-lg px-4 py-2 text-sm text-neutral-600">
            <UserRound className="h-4 w-4 text-neutral-500" />
            <span className="truncate" title={user?.email}>
              {user?.displayName}
            </span>
          </div>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={() => void signOut()}
                className="flex w-full cursor-pointer items-center gap-3 rounded-lg px-4 py-2.5 text-sm font-normal text-neutral-600 transition-colors hover:bg-neutral-100"
              >
                <LogOut className="h-4 w-4 text-neutral-500" />
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
        <div className="flex items-center gap-3 border-b border-neutral-200 bg-white px-4 py-3 lg:hidden">
          <button onClick={() => setSidebarOpen(true)} aria-label="Открыть меню">
            <Menu className="h-5 w-5" />
          </button>
          <span className="text-sm">LectureApp</span>
        </div>
        <main className="flex-1 overflow-auto">{children}</main>
      </div>
    </div>
  );
}
