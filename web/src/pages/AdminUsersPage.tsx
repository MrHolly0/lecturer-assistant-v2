import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { components } from "../app/api/schema";
import {
  createAdminInvitation,
  listUsers,
  updateUserRole,
  updateUserStatus
} from "../app/api/admin-api";
import { useAuth } from "../app/AuthContext";
import { includesQuery, usePagedList } from "../shared/lib/usePagedList";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../shared/ui/select";
import { Tabs, TabsList, TabsTrigger } from "../shared/ui/tabs";
import { PaginationBar, SearchField } from "../widgets/ListControls";
import { Button, LinkButton } from "../shared/ui/button";

type UserProfile = components["schemas"]["UserProfile"];
type UserRole = "ADMIN" | "LECTURER" | "ASSISTANT" | "STUDENT";
type UserStatus = "ACTIVE" | "DISABLED" | "EPHEMERAL";
type AdminInviteRole = "ADMIN" | "LECTURER" | "ASSISTANT";
type Invitation = components["schemas"]["Invitation"];
type UserTab = "active" | "disabled" | "roles";
type RoleFilter = UserRole | "ALL";

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
  const [tab, setTab] = useState<UserTab>("active");
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
        if (tab === "active" && item.status !== "ACTIVE") return false;
        if (tab === "disabled" && item.status !== "DISABLED") return false;
        if (tab === "roles" && roleFilter !== "ALL" && item.role !== roleFilter) return false;
        return includesQuery(query, item.displayName, item.email);
      }),
    [query, roleFilter, tab, users]
  );
  const paged = usePagedList(filteredUsers, 20);

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
            <Select
              value={inviteRole}
              onValueChange={(value) => setInviteRole(value as AdminInviteRole)}
            >
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
                для роли {lastInvite.role}, до{" "}
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
          <h2>Все пользователи</h2>
          <span className="muted">{filteredUsers.length} найдено</span>
        </div>
        <div className="list-toolbar">
          <Tabs value={tab} onValueChange={(value) => setTab(value as UserTab)}>
            <TabsList>
              <TabsTrigger value="active">Активные</TabsTrigger>
              <TabsTrigger value="disabled">Деактивированные</TabsTrigger>
              <TabsTrigger value="roles">По ролям</TabsTrigger>
            </TabsList>
          </Tabs>
          <div className="list-toolbar__filters">
            {tab === "roles" && (
              <Select
                value={roleFilter}
                onValueChange={(value) => setRoleFilter(value as RoleFilter)}
              >
                <SelectTrigger className="table-select">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">Все роли</SelectItem>
                  <SelectItem value="ADMIN">Администратор</SelectItem>
                  <SelectItem value="LECTURER">Лектор</SelectItem>
                  <SelectItem value="ASSISTANT">Ассистент</SelectItem>
                  <SelectItem value="STUDENT">Студент</SelectItem>
                </SelectContent>
              </Select>
            )}
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
              Ничего не найдено.
            </td>
          </tr>
        )}
        {users.map((item) => {
          const ownProfile = item.id === currentUserId;
          const canToggle = item.status === "ACTIVE" || item.status === "DISABLED";
          return (
            <tr key={item.id}>
              <td>{item.displayName}</td>
              <td>{item.email}</td>
              <td>
                <Select
                  value={item.role}
                  onValueChange={(role) => onRole(item.id, role as UserRole)}
                  disabled={ownProfile || rolePending}
                >
                  <SelectTrigger className="table-select">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(roleLabels).map(([value, label]) => (
                      <SelectItem key={value} value={value}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </td>
              <td>
                <span className={`badge badge--${item.status.toLowerCase()}`}>
                  {statusLabels[item.status as UserStatus]}
                </span>
              </td>
              <td>
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
