import type { ReactNode } from "react";
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
        {children}
      </main>
    </div>
  );
}
