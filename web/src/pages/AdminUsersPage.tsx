import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import type { components } from "../app/api/schema";
import { createAdminInvitation, listUsers, updateUserRole, updateUserStatus } from "../app/api/admin-api";
import { useAuth } from "../app/AuthContext";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "../shared/ui/select";

type UserRole = "ADMIN" | "LECTURER" | "ASSISTANT" | "STUDENT";
type AdminInviteRole = "ADMIN" | "LECTURER" | "ASSISTANT";
type Invitation = components["schemas"]["Invitation"];

export function AdminUsersPage() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const [inviteRole, setInviteRole] = useState<AdminInviteRole>("LECTURER");
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

  const roleMut = useMutation({
    mutationFn: ({ personId, role }: { personId: string; role: UserRole }) =>
      updateUserRole(personId, { role }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["admin", "users"] })
  });

  const statusMut = useMutation({
    mutationFn: ({ personId, status }: { personId: string; status: "ACTIVE" | "DISABLED" }) =>
      updateUserStatus(personId, { status }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["admin", "users"] })
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
            <Select value={inviteRole} onValueChange={(value) => setInviteRole(value as AdminInviteRole)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="LECTURER">Лектор</SelectItem>
                <SelectItem value="ASSISTANT">Ассистент</SelectItem>
                <SelectItem value="ADMIN">Администратор</SelectItem>
              </SelectContent>
            </Select>
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
              <Link
                to={`/register?code=${encodeURIComponent(lastInvite.code)}`}
                className="btn-ghost"
              >
                Ссылка для регистрации
              </Link>
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
                <th>Действия</th>
              </tr>
            </thead>
            <tbody>
              {users.length === 0 && (
                <tr>
                  <td colSpan={5} className="muted">
                    Нет пользователей.
                  </td>
                </tr>
              )}
              {users.map((u) => (
                <tr key={u.id}>
                  <td>{u.displayName}</td>
                  <td>{u.email}</td>
                  <td>
                    <Select
                      value={u.role}
                      onValueChange={(role) => roleMut.mutate({ personId: u.id, role: role as UserRole })}
                      disabled={u.id === user?.id || roleMut.isPending}
                    >
                      <SelectTrigger className="table-select">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="ADMIN">Администратор</SelectItem>
                        <SelectItem value="LECTURER">Лектор</SelectItem>
                        <SelectItem value="ASSISTANT">Ассистент</SelectItem>
                        <SelectItem value="STUDENT">Студент</SelectItem>
                      </SelectContent>
                    </Select>
                  </td>
                  <td>
                    <span className={`badge badge--${u.status.toLowerCase()}`}>{u.status}</span>
                  </td>
                  <td>
                    <button
                      type="button"
                      className="btn-ghost"
                      disabled={u.id === user?.id || statusMut.isPending}
                      onClick={() =>
                        statusMut.mutate({
                          personId: u.id,
                          status: u.status === "DISABLED" ? "ACTIVE" : "DISABLED"
                        })
                      }
                    >
                      {u.status === "DISABLED" ? "Активировать" : "Деактивировать"}
                    </button>
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
