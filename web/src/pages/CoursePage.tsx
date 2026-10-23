import { useEffect, useRef, useState } from "react";
import { PendingOperationKey } from "../app/api/operation-key";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import { Plus, UserRoundPlus } from "lucide-react";
import { toast } from "sonner";
import { userErrorMessage } from "../app/api/errors";
import {
  changeCourseMemberRole,
  changeCourseOwner,
  createStudyGroup,
  deleteStudyGroup,
  getCourse,
  removeCourseMember,
  type CourseMember
} from "../app/api/courses-api";
import { CourseContextLinks } from "../widgets/CourseContextLinks";
import { CourseLectureSpotlight } from "../widgets/CourseLectureSpotlight";
import { CourseMemberActions } from "../widgets/CourseMemberActions";
import { CourseSectionNav } from "../widgets/CourseSectionNav";
import { CourseInvitePanel } from "../widgets/CourseInvitePanel";
import { CourseParticipantDialog } from "../widgets/CourseParticipantDialog";
import { CourseGroupManager } from "../widgets/CourseGroupManager";
import { Button, LinkButton } from "../shared/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger
} from "../shared/ui/dialog";
import { Tabs, TabsList, TabsTrigger } from "../shared/ui/tabs";

type CourseRole = "LECTURER" | "ASSISTANT" | "STUDENT";
const ROLE_LABELS: Record<CourseRole, string> = {
  LECTURER: "Преподаватель",
  ASSISTANT: "Ассистент",
  STUDENT: "Студент"
};

export function CoursePage({ courseId }: { courseId: string }) {
  const qc = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const showPeople = searchParams.get("view") === "people";
  const activeTab =
    searchParams.get("section") === "groups"
      ? "groups"
      : searchParams.get("section") === "invite"
        ? "invite"
        : "members";
  const setActiveTab = (value: "members" | "groups" | "invite") => {
    setSearchParams(value === "members" ? { view: "people" } : { view: "people", section: value });
  };
  const [groupName, setGroupName] = useState("");
  const groupKey = useRef(new PendingOperationKey());
  const [groupDialogOpen, setGroupDialogOpen] = useState(false);
  const [participantDialogOpen, setParticipantDialogOpen] = useState(false);
  useEffect(() => {
    setParticipantDialogOpen(false);
    setGroupDialogOpen(false);
  }, [courseId]);

  const {
    data: course,
    isLoading,
    isError,
    refetch
  } = useQuery({
    queryKey: ["courses", courseId],
    queryFn: () => getCourse(courseId)
  });
  const canManage = course?.canManage ?? false;

  useEffect(() => {
    if (course && !canManage && activeTab !== "members") {
      setSearchParams({ view: "people" });
    }
  }, [activeTab, canManage, course, setSearchParams]);

  const createGroupMut = useMutation({
    mutationFn: () => {
      const request = { name: groupName };
      return groupKey.current.run({ courseId, request }, (key) =>
        createStudyGroup(courseId, request, key)
      );
    },
    onSuccess: (created) => {
      qc.setQueryData(["courses", courseId], (current: typeof course | undefined) =>
        current && !current.groups.some((group) => group.id === created.id)
          ? { ...current, groups: [...current.groups, created] }
          : current
      );
      void qc.invalidateQueries({ queryKey: ["courses", courseId] });
      setSearchParams({ view: "people", section: "groups", group: created.id });
      setGroupDialogOpen(false);
      setGroupName("");
      toast.success(`Группа «${created.name}» создана и выбрана.`);
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
        <div className="courses-list-error" role="alert">
          <p>
            {isError
              ? "Не удалось загрузить курс. Проверьте соединение и повторите запрос."
              : "Курс не найден или нет доступа."}
          </p>
          {isError && (
            <Button variant="outline" onClick={() => void refetch()}>
              Повторить
            </Button>
          )}
          <LinkButton to="/courses" variant="ghost">
            К курсам
          </LinkButton>
        </div>
      </div>
    );

  return (
    <div className={`page page--wide course-page${showPeople ? " course-page--people" : ""}`}>
      <header className="page-header course-page-header">
        <div className="course-page-header__copy">
          <Link
            to={activeTab === "invite" ? `/courses/${courseId}?view=people` : "/courses"}
            className="breadcrumb"
          >
            {activeTab === "invite" ? "← К курсу" : "← К курсам"}
          </Link>
          <h1>{activeTab === "invite" ? "Пригласить в курс" : course.title}</h1>
          {activeTab === "invite" ? (
            <p className="muted">{course.title}</p>
          ) : (
            <p className="course-page__mobile-subtitle">
              {showPeople ? "Люди и доступ" : "Обзор курса"}
            </p>
          )}
        </div>
        {course.archived && <span className="badge badge--muted">архив</span>}
      </header>

      {activeTab !== "invite" && <CourseSectionNav courseId={courseId} canManage={canManage} />}
      {activeTab !== "invite" && (
        <div
          className={
            showPeople
              ? "course-page__launch course-page__launch--mobile-hidden"
              : "course-page__launch"
          }
        >
          <CourseLectureSpotlight courseId={courseId} canManage={canManage} />
        </div>
      )}
      {!showPeople && (
        <div className="course-page__mobile-links">
          <CourseContextLinks
            courseId={courseId}
            canManage={canManage}
            onPeople={() => setSearchParams({ view: "people" })}
          />
        </div>
      )}

      <section
        className={`course-settings${!showPeople ? " course-settings--mobile-hidden" : ""}`}
        aria-label={
          activeTab === "groups"
            ? "Учебные группы"
            : activeTab === "invite"
              ? "Пригласить в курс"
              : "Люди и доступ"
        }
      >
        {activeTab !== "invite" && (
          <div className="section-heading course-settings__heading">
            <h2 id="course-settings-title">Люди и доступ</h2>
            {canManage && !course.archived && activeTab === "members" && (
              <Button variant="outline" onClick={() => setParticipantDialogOpen(true)}>
                <UserRoundPlus aria-hidden="true" />
                Добавить ведущего
              </Button>
            )}
          </div>
        )}
        {activeTab !== "invite" && (
          <Tabs
            className="course-settings__tabs"
            value={activeTab}
            onValueChange={(value) => setActiveTab(value as typeof activeTab)}
          >
            <TabsList>
              <TabsTrigger value="members">
                Ведущие ({course.members.filter((member) => member.role !== "STUDENT").length})
              </TabsTrigger>
              {canManage && (
                <TabsTrigger value="groups">Учебные группы ({course.groups.length})</TabsTrigger>
              )}
            </TabsList>
          </Tabs>
        )}

        {activeTab === "members" && (
          <ul className="member-list">
            {course.members.filter((member) => member.role !== "STUDENT").length === 0 && (
              <li className="muted">Ведущие пока не добавлены.</li>
            )}
            {course.members
              .filter((member) => member.role !== "STUDENT")
              .map((m) => {
                const isOwner = m.personId === course.ownerPersonId;
                return (
                  <li key={m.personId} className="member-row">
                    <div className="member-info">
                      <span className="member-name">{m.displayName}</span>
                      <span className="member-description">
                        {ROLE_LABELS[m.role as CourseRole]}
                        {isOwner ? " · владелец" : ""}
                      </span>
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
                          {isOwner ? "Владелец" : ROLE_LABELS[m.role as CourseRole]}
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
            <div className="course-groups-toolbar">
              <div>
                <h3>Учебные группы</h3>
              </div>
              <Dialog open={groupDialogOpen} onOpenChange={setGroupDialogOpen}>
                <DialogTrigger asChild>
                  <Button type="button" variant="outline">
                    <Plus size={17} aria-hidden="true" /> Новая группа
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Новая группа</DialogTitle>
                    <DialogDescription>
                      После создания группа будет выбрана в списке составов.
                    </DialogDescription>
                  </DialogHeader>
                  <form
                    className="course-group-create-form"
                    onSubmit={(event) => {
                      event.preventDefault();
                      createGroupMut.mutate();
                    }}
                  >
                    <label className="field">
                      <span>Название группы</span>
                      <input
                        value={groupName}
                        onChange={(event) => setGroupName(event.target.value)}
                        placeholder="Например, ИВТ-21"
                        required
                        minLength={2}
                      />
                    </label>
                    <div className="course-group-create-form__actions">
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => setGroupDialogOpen(false)}
                      >
                        Отмена
                      </Button>
                      <Button type="submit" disabled={createGroupMut.isPending}>
                        {createGroupMut.isPending ? "Создаём…" : "Создать группу"}
                      </Button>
                    </div>
                  </form>
                </DialogContent>
              </Dialog>
            </div>
            <CourseGroupManager
              courseId={courseId}
              groups={course.groups}
              courseMembers={course.members}
              deleting={deleteGroupMut.isPending}
              onDelete={(groupId) => deleteGroupMut.mutate(groupId)}
            />
          </>
        )}

        {canManage && !course.archived && activeTab === "invite" && (
          <CourseInvitePanel key={courseId} courseId={courseId} groups={course.groups} />
        )}
        {canManage && course.archived && activeTab === "invite" && (
          <p className="muted">В архивный курс нельзя добавлять участников.</p>
        )}
      </section>
      {canManage && !course.archived && (
        <CourseParticipantDialog
          key={courseId}
          courseId={courseId}
          groups={course.groups}
          members={course.members}
          open={participantDialogOpen}
          onOpenChange={setParticipantDialogOpen}
          onAdded={(member: CourseMember) => {
            qc.setQueryData(["courses", courseId], (current: typeof course | undefined) => {
              if (
                !current ||
                current.members.some((existing) => existing.personId === member.personId)
              ) {
                return current;
              }
              return { ...current, members: [...current.members, member] };
            });
            void invalidateCourse();
            toast.success("Участник добавлен в курс");
          }}
        />
      )}
    </div>
  );
}
