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
import { CourseLectureSpotlight } from "../widgets/CourseLectureSpotlight";
import { CourseMemberActions } from "../widgets/CourseMemberActions";
import { CourseSectionNav } from "../widgets/CourseSectionNav";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "../shared/ui/select";
import { Button, LinkButton } from "../shared/ui/button";
import { Tabs, TabsList, TabsTrigger } from "../shared/ui/tabs";

type CourseRole = "LECTURER" | "ASSISTANT" | "STUDENT";
type Invitation = components["schemas"]["Invitation"];

const ROLE_LABELS: Record<CourseRole, string> = {
  LECTURER: "Лектор",
  ASSISTANT: "Ассистент",
  STUDENT: "Студент"
};

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
    <div className="page page--wide course-page">
      <header className="page-header course-page-header">
        <div className="course-page-header__copy">
          <Link to="/courses" className="breadcrumb">
            ← Курсы
          </Link>
          <h1>{course.title}</h1>
          <span className="badge badge--muted">{ROLE_LABELS[course.myRole as CourseRole]}</span>
        </div>
        {course.archived && <span className="badge badge--muted">архив</span>}
      </header>

      <CourseSectionNav courseId={courseId} />
      <CourseLectureSpotlight courseId={courseId} canManage={canManage} />

      <section className="course-settings" aria-labelledby="course-settings-title">
        <div className="section-heading course-settings__heading">
          <h2 id="course-settings-title">Люди и доступ</h2>
        </div>
        <Tabs
          className="course-settings__tabs"
          value={activeTab}
          onValueChange={(value) => setActiveTab(value as typeof activeTab)}
        >
          <TabsList>
            <TabsTrigger value="members">Участники ({course.members.length})</TabsTrigger>
            {canManage && <TabsTrigger value="groups">Группы ({course.groups.length})</TabsTrigger>}
            {canManage && <TabsTrigger value="invite">Пригласить</TabsTrigger>}
          </TabsList>
        </Tabs>

      {activeTab === "members" && (
        <ul className="member-list">
          {course.members.length === 0 && <li className="muted">Нет участников.</li>}
          {course.members.map((m) => {
            const isOwner = m.personId === course.ownerPersonId;
            return (
              <li key={m.personId} className="member-row">
                <div className="member-info">
                  <span className="member-name">
                    {m.displayName}
                    {isOwner && <span className="badge badge--owner">владелец</span>}
                  </span>
                  {canManage && !isOwner && (
                    <span className="member-role-label">{ROLE_LABELS[m.role as CourseRole]}</span>
                  )}
                </div>
                {canManage && !isOwner ? (
                  <CourseMemberActions
                    displayName={m.displayName}
                    role={m.role as CourseRole}
                    disabled={
                      changeRoleMut.isPending ||
                      changeOwnerMut.isPending ||
                      removeMemberMut.isPending
                    }
                    onRoleChange={(role) =>
                      changeRoleMut.mutate({ personId: m.personId, role })
                    }
                    onChangeOwner={() => changeOwnerMut.mutate(m.personId)}
                    onRemove={() => removeMemberMut.mutate(m.personId)}
                  />
                ) : (
                  <span className={`badge badge--${m.role.toLowerCase()}`}>
                    {ROLE_LABELS[m.role as CourseRole]}
                  </span>
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
            <Button type="submit" disabled={createGroupMut.isPending}>
              Создать группу
            </Button>
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
          <Button
            type="button"
            onClick={() => {
              setLastInvite(null);
              inviteMut.mutate();
            }}
            disabled={inviteMut.isPending}
          >
            Сгенерировать код
          </Button>
          {lastInvite && (
            <div className="invite-result">
              <code className="invite-code">{lastInvite.code}</code>
              <span className="muted">
                до {new Date(lastInvite.expiresAt).toLocaleDateString("ru-RU")}
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
      )}
      </section>
    </div>
  );
}
