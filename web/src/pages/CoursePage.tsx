import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { userErrorMessage } from "../app/api/errors";
import {
  changeCourseMemberRole,
  changeCourseOwner,
  createStudyGroup,
  deleteStudyGroup,
  getCourse,
  removeCourseMember
} from "../app/api/courses-api";
import { CourseLectureSpotlight } from "../widgets/CourseLectureSpotlight";
import { CourseMemberActions } from "../widgets/CourseMemberActions";
import { CourseSectionNav } from "../widgets/CourseSectionNav";
import { CourseInvitePanel } from "../widgets/CourseInvitePanel";
import { CourseGroupManager } from "../widgets/CourseGroupManager";
import { Button, LinkButton } from "../shared/ui/button";
import { Tabs, TabsList, TabsTrigger } from "../shared/ui/tabs";

type CourseRole = "LECTURER" | "ASSISTANT" | "STUDENT";
const ROLE_LABELS: Record<CourseRole, string> = {
  LECTURER: "Лектор",
  ASSISTANT: "Ассистент",
  STUDENT: "Студент"
};

export function CoursePage({ courseId }: { courseId: string }) {
  const qc = useQueryClient();
  const [activeTab, setActiveTab] = useState<"members" | "groups" | "invite">("members");
  const [groupName, setGroupName] = useState("");

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
    },
    onError: (error) => toast.error(userErrorMessage(error, "Не удалось создать группу."))
  });

  const deleteGroupMut = useMutation({
    mutationFn: (groupId: string) => deleteStudyGroup(courseId, groupId),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["courses", courseId] }),
    onError: (error) => toast.error(userErrorMessage(error, "Не удалось удалить группу."))
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
        </div>
        {course.archived && <span className="badge badge--muted">архив</span>}
      </header>

      <CourseSectionNav courseId={courseId} canManage={canManage} />
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
                    <span className="member-name">{m.displayName}</span>
                  </div>
                  {canManage && !isOwner ? (
                    <div className="member-actions">
                      {m.role === "STUDENT" && (
                        <LinkButton
                          variant="ghost"
                          to={`/courses/${courseId}/analytics?student=${encodeURIComponent(m.personId)}`}
                        >
                          Аналитика
                        </LinkButton>
                      )}
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
                    </div>
                  ) : (
                    <div className="member-static-meta">
                      <span className="badge member-role-badge">
                        {ROLE_LABELS[m.role as CourseRole]}
                        {isOwner && " · владелец"}
                      </span>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        {canManage && activeTab === "groups" && (
          <>
            <CourseGroupManager
              courseId={courseId}
              groups={course.groups}
              courseMembers={course.members}
              deleting={deleteGroupMut.isPending}
              onDelete={(groupId) => deleteGroupMut.mutate(groupId)}
            />
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
          <CourseInvitePanel courseId={courseId} groups={course.groups} />
        )}
      </section>
    </div>
  );
}
