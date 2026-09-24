import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { userErrorMessage } from "../app/api/errors";
import type { components } from "../app/api/schema";
import {
  changeCourseMemberRole,
  changeCourseOwner,
  createCourseInvitation,
  createStudyGroup,
  deleteStudyGroup,
  getCourse,
  removeCourseMember
} from "../app/api/courses-api";
import { ConfirmActionButton } from "../widgets/ConfirmActionButton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "../shared/ui/select";

type CourseRole = "LECTURER" | "ASSISTANT" | "STUDENT";
type Invitation = components["schemas"]["Invitation"];

export function CoursePage({ courseId }: { courseId: string }) {
  const qc = useQueryClient();
  const [activeTab, setActiveTab] = useState<"members" | "groups" | "invite">("members");
  const [groupName, setGroupName] = useState("");
  const [inviteRole, setInviteRole] = useState<CourseRole>("STUDENT");
  const [lastInvite, setLastInvite] = useState<Invitation | null>(null);

  const {
    data: course,
    isLoading,
    isError
  } = useQuery({
    queryKey: ["courses", courseId],
    queryFn: () => getCourse(courseId)
  });
  const canManage = course?.canManage ?? false;

  useEffect(() => {
    if (!canManage && activeTab !== "members") {
      setActiveTab("members");
    }
  }, [activeTab, canManage]);

  const createGroupMut = useMutation({
    mutationFn: () => createStudyGroup(courseId, { name: groupName }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["courses", courseId] });
      setGroupName("");
    }
  });

  const deleteGroupMut = useMutation({
    mutationFn: (groupId: string) => deleteStudyGroup(courseId, groupId),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["courses", courseId] })
  });

  const inviteMut = useMutation({
    mutationFn: () => createCourseInvitation(courseId, { role: inviteRole, ttlHours: 168 }),
    onSuccess: (inv) => setLastInvite(inv)
  });

  const invalidateCourse = () => qc.invalidateQueries({ queryKey: ["courses", courseId] });
  const onMemberError = (error: unknown) =>
    toast.error(userErrorMessage(error, "Не удалось изменить участника."));

  const changeRoleMut = useMutation({
    mutationFn: (vars: { personId: string; role: CourseRole }) =>
      changeCourseMemberRole(courseId, vars.personId, vars.role),
    onSuccess: () => {
      void invalidateCourse();
      toast.success("Роль обновлена");
    },
    onError: onMemberError
  });
  const removeMemberMut = useMutation({
    mutationFn: (personId: string) => removeCourseMember(courseId, personId),
    onSuccess: () => {
      void invalidateCourse();
      toast.success("Участник удалён");
    },
    onError: onMemberError
  });
  const changeOwnerMut = useMutation({
    mutationFn: (personId: string) => changeCourseOwner(courseId, personId),
    onSuccess: () => {
      void invalidateCourse();
      toast.success("Владелец курса изменён");
    },
    onError: onMemberError
  });

  if (isLoading)
    return (
      <div className="page">
        <p className="muted">Загрузка...</p>
      </div>
    );
  if (isError || !course)
    return (
      <div className="page">
        <p className="form-error">Курс не найден или нет доступа.</p>
      </div>
    );

  return (
    <div className="page">
      <div className="page-header">
        <Link to="/courses" className="breadcrumb">
          ← Курсы
        </Link>
        <h1>{course.title}</h1>
        {course.archived && <span className="badge badge--muted">архив</span>}
        <Link to={`/courses/${courseId}/materials`} className="btn-primary">
          Материалы
        </Link>
      </div>

      <div className="tab-row">
        <button
          type="button"
          className={`tab ${activeTab === "members" ? "tab--active" : ""}`}
          onClick={() => setActiveTab("members")}
        >
          Участники ({course.members.length})
        </button>
        {canManage && (
          <button
            type="button"
            className={`tab ${activeTab === "groups" ? "tab--active" : ""}`}
            onClick={() => setActiveTab("groups")}
          >
            Группы ({course.groups.length})
          </button>
        )}
        {canManage && (
          <button
            type="button"
            className={`tab ${activeTab === "invite" ? "tab--active" : ""}`}
            onClick={() => setActiveTab("invite")}
          >
            Пригласить
          </button>
        )}
      </div>

      {activeTab === "members" && (
        <ul className="member-list">
          {course.members.length === 0 && <li className="muted">Нет участников.</li>}
          {course.members.map((m) => {
            const isOwner = m.personId === course.ownerPersonId;
            return (
              <li key={m.personId} className="member-row">
                <span className="member-name">
                  {m.displayName}
                  {isOwner && <span className="badge badge--owner">владелец</span>}
                </span>
                {canManage && !isOwner ? (
                  <div className="member-actions">
                    <Select
                      value={m.role}
                      onValueChange={(value) =>
                        changeRoleMut.mutate({ personId: m.personId, role: value as CourseRole })
                      }
                    >
                      <SelectTrigger className="member-role-select">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="STUDENT">Студент</SelectItem>
                        <SelectItem value="ASSISTANT">Ассистент</SelectItem>
                        <SelectItem value="LECTURER">Лектор</SelectItem>
                      </SelectContent>
                    </Select>
                    <ConfirmActionButton
                      title="Сделать владельцем курса?"
                      description={`${m.displayName} станет лектором-владельцем курса. Вы останетесь лектором.`}
                      confirmLabel="Сделать владельцем"
                      disabled={changeOwnerMut.isPending}
                      onConfirm={() => changeOwnerMut.mutate(m.personId)}
                    >
                      Владелец
                    </ConfirmActionButton>
                    <ConfirmActionButton
                      title="Удалить участника?"
                      description={`${m.displayName} потеряет доступ к курсу.`}
                      disabled={removeMemberMut.isPending}
                      onConfirm={() => removeMemberMut.mutate(m.personId)}
                    >
                      Удалить
                    </ConfirmActionButton>
                  </div>
                ) : (
                  <span className={`badge badge--${m.role.toLowerCase()}`}>{m.role}</span>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {canManage && activeTab === "groups" && (
        <>
          <ul className="card-list">
            {course.groups.length === 0 && <li className="muted">Нет групп.</li>}
            {course.groups.map((g) => (
              <li key={g.id} className="card-link">
                <span className="card-title">{g.name}</span>
                <ConfirmActionButton
                  title="Удалить группу?"
                  description="Группа будет удалена из курса. Участники курса сохранятся."
                  disabled={deleteGroupMut.isPending}
                  onConfirm={() => deleteGroupMut.mutate(g.id)}
                >
                  Удалить
                </ConfirmActionButton>
              </li>
            ))}
          </ul>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              createGroupMut.mutate();
            }}
            className="inline-form"
            style={{ marginTop: 16 }}
          >
            <input
              value={groupName}
              onChange={(e) => setGroupName(e.target.value)}
              placeholder="Название группы"
              required
              minLength={2}
            />
            <button type="submit" className="btn-primary" disabled={createGroupMut.isPending}>
              Создать группу
            </button>
          </form>
        </>
      )}

      {canManage && activeTab === "invite" && (
        <div className="invite-panel">
          <label className="field">
            <span>Роль участника</span>
            <Select value={inviteRole} onValueChange={(value) => setInviteRole(value as CourseRole)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="STUDENT">Студент</SelectItem>
                <SelectItem value="ASSISTANT">Ассистент</SelectItem>
                <SelectItem value="LECTURER">Лектор</SelectItem>
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
            Сгенерировать код
          </button>
          {lastInvite && (
            <div className="invite-result">
              <code className="invite-code">{lastInvite.code}</code>
              <span className="muted">
                до {new Date(lastInvite.expiresAt).toLocaleDateString("ru-RU")}
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
      )}
    </div>
  );
}
