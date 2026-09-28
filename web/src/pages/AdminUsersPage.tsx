import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown } from "lucide-react";
import type { components } from "../app/api/schema";
import {
  createAdminInvitation,
  listUsers,
  updateUserRole,
  updateUserStatus
} from "../app/api/admin-api";
import { useAuth } from "../app/AuthContext";
import { includesQuery, usePagedList } from "../shared/lib/usePagedList";
import { PaginationBar, SearchField } from "../widgets/ListControls";
import { Button, LinkButton } from "../shared/ui/button";

type UserProfile = components["schemas"]["UserProfile"];
type UserRole = "ADMIN" | "LECTURER" | "ASSISTANT" | "STUDENT";
type UserStatus = "ACTIVE" | "DISABLED" | "EPHEMERAL";
type AdminInviteRole = "ADMIN" | "LECTURER" | "ASSISTANT";
type Invitation = components["schemas"]["Invitation"];
type RoleFilter = UserRole | "ALL";
type StatusFilter = "ACTIVE" | "DISABLED" | "ALL";

const roleLabels: Record<UserRole, string> = {
  ADMIN: "Администратор",
  LECTURER: "Лектор",
  ASSISTANT: "Ассистент",
  STUDENT: "Студент"
};

const statusLabels: Record<UserStatus, string> = {
  ACTIVE: "Активен",
  DISABLED: "Деактивирован",
  EPHEMERAL: "Временный"
};

export function AdminUsersPage() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const [inviteRole, setInviteRole] = useState<AdminInviteRole>("LECTURER");
  const [lastInvite, setLastInvite] = useState<Invitation | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("ACTIVE");
  const [roleFilter, setRoleFilter] = useState<RoleFilter>("ALL");
  const [query, setQuery] = useState("");

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

  const filteredUsers = useMemo(
    () =>
      users.filter((item) => {
        if (statusFilter !== "ALL" && item.status !== statusFilter) return false;
        if (roleFilter !== "ALL" && item.role !== roleFilter) return false;
        return includesQuery(query, item.displayName, item.email);
      }),
    [query, roleFilter, statusFilter, users]
  );
  const paged = usePagedList(filteredUsers, 20);

  return (
    <div className="page admin-users-page">
      <div className="page-header">
        <h1>Пользователи</h1>
      </div>

      <section className="section">
        <h2>Создать приглашение</h2>
        <div className="invite-panel admin-invite-panel">
          <label className="field">
            <span>Роль</span>
            <span className="admin-select-wrap">
              <select
                className="admin-native-select"
                aria-label="Роль приглашения"
                value={inviteRole}
                onChange={(event) => setInviteRole(event.target.value as AdminInviteRole)}
              >
                <option value="LECTURER">Лектор</option>
                <option value="ASSISTANT">Ассистент</option>
                <option value="ADMIN">Администратор</option>
              </select>
              <ChevronDown size={16} aria-hidden="true" />
            </span>
          </label>
          <Button
            type="button"
            onClick={() => {
              setLastInvite(null);
              inviteMut.mutate();
            }}
            disabled={inviteMut.isPending}
          >
            Создать приглашение
          </Button>
          {lastInvite && (
            <div className="invite-result">
              <code className="invite-code">{lastInvite.code}</code>
              <span className="muted">
                Для роли {roleLabels[lastInvite.role as UserRole]}, до{" "}
                {new Date(lastInvite.expiresAt).toLocaleDateString("ru-RU")}
              </span>
              <LinkButton
                to={`/register?code=${encodeURIComponent(lastInvite.code)}`}
                variant="outline"
              >
                Ссылка для регистрации
              </LinkButton>
            </div>
          )}
        </div>
      </section>

      <section className="section">
        <div className="section-heading">
          <h2>Пользователи</h2>
          <span className="muted">{filteredUsers.length} найдено</span>
        </div>
        <div className="admin-users-filters">
          <label className="field">
            <span>Статус</span>
            <span className="admin-select-wrap">
              <select
                className="admin-native-select"
                aria-label="Статус пользователей"
                value={statusFilter}
                onChange={(event) => setStatusFilter(event.target.value as StatusFilter)}
              >
                <option value="ACTIVE">Активные</option>
                <option value="DISABLED">Деактивированные</option>
                <option value="ALL">Все статусы</option>
              </select>
              <ChevronDown size={16} aria-hidden="true" />
            </span>
          </label>
          <label className="field">
            <span>Роль</span>
            <span className="admin-select-wrap">
              <select
                className="admin-native-select"
                aria-label="Роль пользователей"
                value={roleFilter}
                onChange={(event) => setRoleFilter(event.target.value as RoleFilter)}
              >
                <option value="ALL">Все роли</option>
                <option value="ADMIN">Администратор</option>
                <option value="LECTURER">Лектор</option>
                <option value="ASSISTANT">Ассистент</option>
                <option value="STUDENT">Студент</option>
              </select>
              <ChevronDown size={16} aria-hidden="true" />
            </span>
          </label>
          <div className="admin-users-filters__search">
            <span>Поиск</span>
            <SearchField value={query} onChange={setQuery} placeholder="Имя или email" />
          </div>
        </div>
        {isLoading ? (
          <p className="muted">Загрузка...</p>
        ) : (
          <UsersTable
            users={paged.pageItems}
            currentUserId={user?.id}
            rolePending={roleMut.isPending}
            statusPending={statusMut.isPending}
            onRole={(personId, role) => roleMut.mutate({ personId, role })}
            onStatus={(personId, status) => statusMut.mutate({ personId, status })}
          />
        )}
        <PaginationBar {...paged} onPageChange={paged.setPage} />
      </section>
    </div>
  );
}

interface UsersTableProps {
  users: UserProfile[];
  currentUserId?: string;
  rolePending: boolean;
  statusPending: boolean;
  onRole: (personId: string, role: UserRole) => void;
  onStatus: (personId: string, status: "ACTIVE" | "DISABLED") => void;
}

function UsersTable({
  users,
  currentUserId,
  rolePending,
  statusPending,
  onRole,
  onStatus
}: UsersTableProps) {
  return (
    <table className="data-table admin-users-table">
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
          <tr className="admin-users-table__empty">
            <td colSpan={5} className="muted">
              Ничего не найдено.
            </td>
          </tr>
        )}
        {users.map((item) => {
          const ownProfile = item.id === currentUserId;
          const canToggle = item.status === "ACTIVE" || item.status === "DISABLED";
          return (
            <tr key={item.id}>
              <td data-label="Имя">{item.displayName}</td>
              <td data-label="Email">{item.email}</td>
              <td data-label="Роль">
                <span className="admin-select-wrap table-select">
                  <select
                    className="admin-native-select"
                    aria-label={`Роль ${item.displayName}`}
                    value={item.role}
                    onChange={(event) => onRole(item.id, event.target.value as UserRole)}
                    disabled={ownProfile || rolePending}
                  >
                    {Object.entries(roleLabels).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                  <ChevronDown size={16} aria-hidden="true" />
                </span>
              </td>
              <td data-label="Статус">
                <span className={`badge badge--${item.status.toLowerCase()}`}>
                  {statusLabels[item.status as UserStatus]}
                </span>
              </td>
              <td data-label="Действие">
                <Button
                  type="button"
                  variant="outline"
                  disabled={ownProfile || !canToggle || statusPending}
                  onClick={() =>
                    onStatus(item.id, item.status === "DISABLED" ? "ACTIVE" : "DISABLED")
                  }
                >
                  {item.status === "DISABLED" ? "Активировать" : "Деактивировать"}
                </Button>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
