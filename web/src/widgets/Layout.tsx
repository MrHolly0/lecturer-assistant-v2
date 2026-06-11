import type { ReactNode } from 'react';
import { useAuth } from '../app/AuthContext';

export function Layout({ children }: { children: ReactNode }) {
  const { user, signOut } = useAuth();
  const hash = window.location.hash;

  return (
    <div className="app-layout">
      <nav className="sidebar">
        <div className="sidebar-brand">LA v2</div>
        <ul className="sidebar-nav">
          <li>
            <a href="#/courses" className={hash.startsWith('#/courses') ? 'active' : ''}>
              Курсы
            </a>
          </li>
          {user?.role === 'ADMIN' && (
            <li>
              <a href="#/admin/users" className={hash === '#/admin/users' ? 'active' : ''}>
                Пользователи
              </a>
            </li>
          )}
        </ul>
        <div className="sidebar-footer">
          <span className="sidebar-user" title={user?.email}>{user?.displayName}</span>
          <span className={`badge badge--${user?.role.toLowerCase()}`}>{user?.role}</span>
          <button className="btn-ghost" onClick={() => void signOut()}>Выйти</button>
        </div>
      </nav>
      <main className="page-content">{children}</main>
    </div>
  );
}
