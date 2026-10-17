import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, Copy } from "lucide-react";
import { toast } from "sonner";
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
import { userErrorMessage } from "../app/api/errors";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from "../shared/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "../shared/ui/dialog";

type UserProfile = components["schemas"]["UserProfile"];
type UserRole = "ADMIN" | "LECTURER" | "ASSISTANT" | "STUDENT";
type UserStatus = "ACTIVE" | "DISABLED" | "EPHEMERAL";
type AdminInviteRole = "ADMIN" | "LECTURER" | "ASSISTANT";
type Invitation = components["schemas"]["Invitation"];
type RoleFilter = UserRole | "ALL";
type StatusFilter = "ACTIVE" | "DISABLED" | "ALL";

const roleLabels: Record<UserRole, string> = {
  ADMIN: "Администратор",
  LECTURER: "Преподаватель",
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
  const [inviteOpen, setInviteOpen] = useState(false);
  const [confirmAdminInvite, setConfirmAdminInvite] = useState(false);
  const [roleChange, setRoleChange] = useState<{ person: UserProfile; role: UserRole } | null>(
    null
  );
  const [statusChange, setStatusChange] = useState<{
    person: UserProfile;
    status: "ACTIVE" | "DISABLED";
  } | null>(null);

  const {
    data: users = [],
    isLoading,
    isError,
    refetch
  } = useQuery({
    queryKey: ["admin", "users"],
    queryFn: listUsers
  });

  const inviteMut = useMutation({
    mutationFn: () => createAdminInvitation({ role: inviteRole, ttlHours: 168 }),
    onSuccess: (inv) => {
      void qc.invalidateQueries({ queryKey: ["admin", "users"] });
      setLastInvite(inv);
      setConfirmAdminInvite(false);
      toast.success("Приглашение создано");
    },
    onError: (error) => toast.error(userErrorMessage(error, "Не удалось создать приглашение"))
  });
  const roleMut = useMutation({
    mutationFn: ({ personId, role }: { personId: string; role: UserRole }) =>
      updateUserRole(personId, { role }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["admin", "users"] });
      setRoleChange(null);
      toast.success("Системная роль обновлена");
    },
    onError: (error) => toast.error(userErrorMessage(error, "Не удалось изменить системную роль"))
  });
  const statusMut = useMutation({
    mutationFn: ({ personId, status }: { personId: string; status: "ACTIVE" | "DISABLED" }) =>
      updateUserStatus(personId, { status }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["admin", "users"] });
      setStatusChange(null);
      toast.success(
        statusChange?.status === "DISABLED"
          ? "Учётная запись деактивирована"
          : "Учётная запись активирована"
      );
    },
    onError: (error) =>
      toast.error(userErrorMessage(error, "Не удалось изменить статус учётной записи"))
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

  function requestInvite() {
    setLastInvite(null);
    setInviteOpen(true);
  }

  function createInvite() {
    if (inviteRole === "ADMIN") {
      setConfirmAdminInvite(true);
      return;
    }
    inviteMut.mutate();
  }

  return (
    <div className="page admin-users-page">
      <div className="page-header">
        <div>
          <h1>Учётные записи</h1>
          <p className="muted">Системные роли и доступ к аккаунтам</p>
        </div>
        <LinkButton to="/organization" variant="outline">
          Сотрудники
        </LinkButton>
        <Button onClick={requestInvite}>Пригласить пользователя</Button>
      </div>

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
                <option value="LECTURER">Преподаватель</option>
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
          <p className="muted" role="status">
            Загрузка учётных записей…
          </p>
        ) : isError ? (
          <div className="org-state" role="alert">
            <p>Не удалось загрузить учётные записи. Проверьте соединение и повторите запрос.</p>
            <Button variant="outline" onClick={() => void refetch()}>
              Повторить
            </Button>
          </div>
        ) : (
          <UsersTable
            users={paged.pageItems}
            currentUserId={user?.id}
            rolePending={roleMut.isPending}
            statusPending={statusMut.isPending}
            onRole={(person, role) => setRoleChange({ person, role })}
            onStatus={(person, status) => setStatusChange({ person, status })}
          />
        )}
        {!isLoading && !isError && <PaginationBar {...paged} onPageChange={paged.setPage} />}
      </section>

      <Dialog
        open={inviteOpen}
        onOpenChange={(open) => !inviteMut.isPending && setInviteOpen(open)}
      >
        <DialogContent className="admin-invite-dialog">
          <DialogHeader>
            <DialogTitle>Пригласить пользователя</DialogTitle>
            <DialogDescription>
              Приглашение действует 7 дней и закрепляет системную роль.
            </DialogDescription>
          </DialogHeader>
          <label className="field">
            <span>Системная роль</span>
            <span className="admin-select-wrap">
              <select
                className="admin-native-select"
                value={inviteRole}
                onChange={(event) => {
                  setInviteRole(event.target.value as AdminInviteRole);
                  setLastInvite(null);
                }}
              >
                <option value="LECTURER">Преподаватель</option>
                <option value="ASSISTANT">Ассистент</option>
                <option value="ADMIN">Администратор</option>
              </select>
              <ChevronDown size={16} aria-hidden="true" />
            </span>
          </label>
          {inviteRole === "ADMIN" && (
            <p className="form-warning">
              Администратор получает полный доступ к учётным записям и структуре сотрудников.
            </p>
          )}
          {lastInvite && (
            <div className="invite-result">
              <code className="invite-code">{lastInvite.code}</code>
              <span className="muted">
                Роль: {roleLabels[lastInvite.role as UserRole]} · действует до{" "}
                {new Date(lastInvite.expiresAt).toLocaleString("ru-RU")}
              </span>
              <div className="invite-result__actions">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => void copyInvite(lastInvite.code, "Код приглашения скопирован")}
                >
                  <Copy size={16} aria-hidden="true" /> Скопировать код
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() =>
                    void copyInvite(
                      registrationHref(lastInvite.code),
                      "Ссылка на регистрацию скопирована"
                    )
                  }
                >
                  <Copy size={16} aria-hidden="true" /> Скопировать ссылку
                </Button>
                <LinkButton
                  to={`/register?code=${encodeURIComponent(lastInvite.code)}`}
                  variant="ghost"
                >
                  Открыть регистрацию
                </LinkButton>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setInviteOpen(false)}
              disabled={inviteMut.isPending}
            >
              Закрыть
            </Button>
            {!lastInvite && (
              <Button type="button" onClick={createInvite} disabled={inviteMut.isPending}>
                {inviteMut.isPending ? "Создание…" : "Создать приглашение"}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={Boolean(confirmAdminInvite)} onOpenChange={setConfirmAdminInvite}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Создать приглашение администратора?</AlertDialogTitle>
            <AlertDialogDescription>
              Новый аккаунт получит полный системный доступ, включая управление учётными записями.
              Продолжить?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Отмена</AlertDialogCancel>
            <AlertDialogAction onClick={() => inviteMut.mutate()} disabled={inviteMut.isPending}>
              Создать приглашение
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={Boolean(roleChange)} onOpenChange={(open) => !open && setRoleChange(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Изменить системную роль?</AlertDialogTitle>
            <AlertDialogDescription>
              {roleChange && (
                <>
                  Для {roleChange.person.displayName} будет установлена роль «
                  {roleLabels[roleChange.role]}».{" "}
                  {roleChange.role === "ADMIN"
                    ? "Она даёт полный доступ к системе, включая учётные записи и группы сотрудников."
                    : "Права на конкретные курсы и доступ в группах сотрудников изменяются отдельно."}
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={roleMut.isPending}>Отмена</AlertDialogCancel>
            <AlertDialogAction
              onClick={() =>
                roleChange &&
                roleMut.mutate({ personId: roleChange.person.id, role: roleChange.role })
              }
              disabled={roleMut.isPending}
            >
              {roleMut.isPending ? "Сохранение…" : "Подтвердить роль"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={Boolean(statusChange)}
        onOpenChange={(open) => !open && setStatusChange(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {statusChange?.status === "DISABLED"
                ? "Деактивировать учётную запись?"
                : "Активировать учётную запись?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {statusChange && (
                <>
                  {statusChange.person.displayName} · {statusChange.person.email}.{" "}
                  {statusChange.status === "DISABLED"
                    ? "Пользователь не сможет войти в систему. Учётную запись можно будет активировать снова."
                    : "Пользователь снова сможет войти в систему."}
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={statusMut.isPending}>Отмена</AlertDialogCancel>
            <AlertDialogAction
              onClick={() =>
                statusChange &&
                statusMut.mutate({ personId: statusChange.person.id, status: statusChange.status })
              }
              disabled={statusMut.isPending}
            >
              {statusMut.isPending
                ? "Сохранение…"
                : statusChange?.status === "DISABLED"
                  ? "Деактивировать"
                  : "Активировать"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function registrationHref(code: string) {
  const url = new URL(window.location.href);
  url.hash = `/register?code=${encodeURIComponent(code)}`;
  return url.toString();
}

async function copyInvite(value: string, successMessage: string) {
  try {
    await navigator.clipboard.writeText(value);
    toast.success(successMessage);
  } catch {
    toast.error("Не удалось скопировать. Выделите значение и скопируйте его вручную.");
  }
}

interface UsersTableProps {
  users: UserProfile[];
  currentUserId?: string;
  rolePending: boolean;
  statusPending: boolean;
  onRole: (person: UserProfile, role: UserRole) => void;
  onStatus: (person: UserProfile, status: "ACTIVE" | "DISABLED") => void;
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
                    onChange={(event) => {
                      const role = event.target.value as UserRole;
                      if (role !== item.role) onRole(item, role);
                    }}
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
                  onClick={() => onStatus(item, item.status === "DISABLED" ? "ACTIVE" : "DISABLED")}
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
