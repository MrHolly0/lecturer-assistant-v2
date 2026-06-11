import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { components } from "../app/api/schema";
import { createAdminInvitation, listUsers } from "../app/api/admin-api";

type AdminRole = "ADMIN" | "LECTURER" | "ASSISTANT";
type Invitation = components["schemas"]["Invitation"];

export function AdminUsersPage() {
  const qc = useQueryClient();
  const [inviteRole, setInviteRole] = useState<AdminRole>("LECTURER");
  const [lastInvite, setLastInvite] = useState<Invitation | null>(null);

  const { data: users = [], isLoading } = useQuery({
    queryKey: ["admin", "users"],
    queryFn: listUsers
  });

  const inviteMut = useMutation({
    mutationFn: () => createAdminInvitation({ role: inviteRole, ttlHours: 168 }),
    onSuccess: (inv) => {
      void qc.invalidateQueries({ queryKey: ["admin", "users"] });
      setLastInvite(inv);
    }
  });

  return (
    <div className="page">
      <div className="page-header">
        <h1>Пользователи</h1>
      </div>

      <section className="section">
        <h2>Создать приглашение</h2>
        <div className="invite-panel">
          <label className="field">
            <span>Роль</span>
            <select value={inviteRole} onChange={(e) => setInviteRole(e.target.value as AdminRole)}>
              <option value="LECTURER">Лектор</option>
              <option value="ASSISTANT">Ассистент</option>
              <option value="ADMIN">Администратор</option>
            </select>
          </label>
          <button
            type="button"
            className="btn-primary"
            onClick={() => {
              setLastInvite(null);
              inviteMut.mutate();
            }}
            disabled={inviteMut.isPending}
          >
            Создать приглашение
          </button>
          {lastInvite && (
            <div className="invite-result">
              <code className="invite-code">{lastInvite.code}</code>
              <span className="muted">
                для роли {lastInvite.role}, до{" "}
                {new Date(lastInvite.expiresAt).toLocaleDateString("ru-RU")}
              </span>
              <a href={`#/register?code=${lastInvite.code}`} className="btn-ghost">
                Ссылка для регистрации
              </a>
            </div>
          )}
        </div>
      </section>

      <section className="section">
        <h2>Все пользователи</h2>
        {isLoading ? (
          <p className="muted">Загрузка...</p>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Имя</th>
                <th>Email</th>
                <th>Роль</th>
                <th>Статус</th>
              </tr>
            </thead>
            <tbody>
              {users.length === 0 && (
                <tr>
                  <td colSpan={4} className="muted">
                    Нет пользователей.
                  </td>
                </tr>
              )}
              {users.map((u) => (
                <tr key={u.id}>
                  <td>{u.displayName}</td>
                  <td>{u.email}</td>
                  <td>
                    <span className={`badge badge--${u.role.toLowerCase()}`}>{u.role}</span>
                  </td>
                  <td>
                    <span className={`badge badge--${u.status.toLowerCase()}`}>{u.status}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
