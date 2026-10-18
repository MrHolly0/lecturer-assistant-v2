import type { ReactNode } from "react";
import { QrCode } from "lucide-react";
import { LinkButton } from "../shared/ui/button";
import { AppHeader } from "./Layout";

export function AuthPageFrame({
  children,
  className = ""
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className="auth-layout">
      <AppHeader variant="public" mainId="auth-content" />
      <main id="auth-content" className={`auth-shell ${className}`} tabIndex={-1}>
        <div className="auth-session-entry">
          <LinkButton to="/student/join" variant="outline">
            <QrCode aria-hidden="true" />
            Подключиться к лекции
          </LinkButton>
          <p>По коду с экрана преподавателя</p>
        </div>
        {children}
      </main>
    </div>
  );
}
