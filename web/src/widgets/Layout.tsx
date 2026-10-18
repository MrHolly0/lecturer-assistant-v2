import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import {
  ArrowLeft,
  BookOpen,
  ChevronDown,
  ChevronRight,
  Home,
  Link2,
  LogOut,
  Menu,
  MoreHorizontal,
  QrCode,
  Shield,
  UserRound,
  Users
} from "lucide-react";
import { Link, NavLink, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../app/AuthContext";
import { landingPath } from "../app/routes";
import { BrandMark } from "../shared/brand/BrandMark";
import { Button, IconButton } from "../shared/ui/button";
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from "../shared/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from "../shared/ui/dropdown-menu";
import { ThemeToggle } from "./ThemeToggle";

const navItems = [
  {
    path: "/student/join",
    icon: QrCode,
    label: "Подключиться к лекции",
    roles: ["ADMIN", "LECTURER", "ASSISTANT", "STUDENT"],
    more: true
  },
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
    roles: ["ADMIN", "LECTURER", "ASSISTANT"],
    more: true
  },
  { path: "/admin/users", icon: Shield, label: "Учётные записи", roles: ["ADMIN"], more: true }
];
const roleLabels: Record<string, string> = {
  ADMIN: "Администратор",
  LECTURER: "Преподаватель",
  ASSISTANT: "Ассистент",
  STUDENT: "Студент"
};

export function AppHeader({
  variant = "default",
  mainId = "main-content"
}: { variant?: "default" | "public"; mainId?: string } = {}) {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const publicHeader = variant === "public" || !user;
  const mobileCourseHeader =
    !publicHeader && /^\/courses\/[^/]+$/.test(location.pathname) && !location.search;
  const [menuOpen, setMenuOpen] = useState(false);
  const items = navItems.filter((item) => !publicHeader && user && item.roles.includes(user.role));
  const moreItems = items.filter((item) => item.more);
  useEffect(() => {
    setMenuOpen(false);
  }, [location.pathname]);
  useEffect(() => {
    const media = window.matchMedia("(min-width: 1100px)");
    const closeOnDesktop = () => {
      if (media.matches) setMenuOpen(false);
    };
    media.addEventListener("change", closeOnDesktop);
    return () => media.removeEventListener("change", closeOnDesktop);
  }, []);
  async function handleSignOut() {
    await signOut();
    navigate("/login", { replace: true });
  }
  const brand = (
    <Link
      to={user ? landingPath(user.role) : "/login"}
      className="app-brand"
      aria-label="Lecturer Assistant"
      onClick={() => setMenuOpen(false)}
    >
      <BrandMark />
      <span>Lecturer Assistant</span>
    </Link>
  );
  const profile = (
    <div className="app-profile-copy">
      <strong>{user?.displayName}</strong>
      <span>{user && roleLabels[user.role]}</span>
      <span>{user?.email}</span>
    </div>
  );
  return (
    <>
      <a
        href={`#${mainId}`}
        className="app-skip-link"
        onClick={(event) => {
          event.preventDefault();
          const main = document.getElementById(mainId);
          if (main && !main.hasAttribute("tabindex")) main.setAttribute("tabindex", "-1");
          main?.focus();
          main?.scrollIntoView({ block: "start" });
        }}
      >
        К содержимому
      </a>
      <header
        className={`app-header${mobileCourseHeader ? " app-header--course" : ""}${publicHeader ? " app-header--public" : ""}`}
      >
        {mobileCourseHeader && (
          <Link to="/courses" className="app-course-back">
            <ArrowLeft aria-hidden="true" />
            <span>Курсы</span>
          </Link>
        )}
        {brand}
        {!publicHeader && (
          <nav className="app-header-nav" aria-label="Основная навигация">
            {items
              .filter((item) => !item.more)
              .map((item) => (
                <NavLink
                  key={item.path}
                  to={item.path}
                  className={({ isActive }) =>
                    isActive ? "app-header-nav__item is-active" : "app-header-nav__item"
                  }
                >
                  {item.label}
                </NavLink>
              ))}
            {moreItems.length > 0 && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    className={`app-header-nav__item${moreItems.some((item) => location.pathname.startsWith(item.path)) ? " is-active" : ""}`}
                  >
                    Ещё <ChevronDown size={16} />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="app-more-menu">
                  {moreItems.map(({ path, label, icon: Icon }) => (
                    <DropdownMenuItem key={path} asChild>
                      <Link to={path}>
                        <Icon />
                        {label}
                      </Link>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </nav>
        )}
        <div className="app-header-profile">
          <ThemeToggle compact />
          {!publicHeader && (
            <>
              <span className="app-header-divider" />
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" className="app-profile-trigger">
                    <span className="app-avatar">
                      <UserRound />
                    </span>
                    <span>{user?.displayName}</span>
                    <ChevronDown size={16} />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="app-profile-menu">
                  {profile}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onSelect={() => void handleSignOut()}>
                    <LogOut />
                    Выйти
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </>
          )}
        </div>
        {!publicHeader && (
          <Dialog open={menuOpen} onOpenChange={setMenuOpen}>
            <DialogTrigger asChild>
              <IconButton
                label="Открыть меню"
                className="app-mobile-menu-trigger"
                aria-expanded={menuOpen}
              >
                {mobileCourseHeader ? <MoreHorizontal /> : <Menu />}
              </IconButton>
            </DialogTrigger>
            <DialogContent
              className="app-mobile-menu"
              aria-describedby={undefined}
              onOpenAutoFocus={(event) => {
                event.preventDefault();
                requestAnimationFrame(() =>
                  document.querySelector<HTMLElement>(".app-mobile-menu nav a")?.focus()
                );
              }}
            >
              <DialogTitle className="sr-only">Основное меню</DialogTitle>
              <div className="app-mobile-menu__header">{brand}</div>
              <div className="app-mobile-menu__body">
                <nav aria-label="Мобильная навигация">
                  {items.map(({ path, label, icon: Icon }) => (
                    <NavLink
                      key={path}
                      to={path}
                      onClick={() => setMenuOpen(false)}
                      className={({ isActive }) =>
                        `app-mobile-menu__item${isActive ? " is-active" : ""}`
                      }
                    >
                      <Icon />
                      <span>{label}</span>
                      <ChevronRight />
                    </NavLink>
                  ))}
                </nav>
                <div className="app-mobile-menu__settings">
                  <p>Настройки</p>
                  <ThemeToggle />
                </div>
                <div className="app-mobile-menu__profile">
                  <span className="app-avatar">
                    <UserRound />
                  </span>
                  {profile}
                </div>
                <Button
                  variant="ghost"
                  className="app-mobile-menu__logout"
                  onClick={() => void handleSignOut()}
                >
                  <LogOut />
                  Выйти
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        )}
      </header>
    </>
  );
}

export function Layout({ children }: { children: ReactNode }) {
  return (
    <div className="app-layout">
      <AppHeader />
      <main id="main-content" className="app-main" tabIndex={-1}>
        {children}
      </main>
    </div>
  );
}
