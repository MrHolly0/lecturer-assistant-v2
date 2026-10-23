import { useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent, MouseEvent } from "react";
import { Plus, RotateCcw } from "lucide-react";
import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { userErrorMessage } from "../app/api/errors";
import { PendingOperationKey } from "../app/api/operation-key";
import {
  archiveCourse,
  createCourse,
  getCourse,
  hardDeleteCourse,
  listCourses,
  restoreCourse
} from "../app/api/courses-api";
import { listLectures } from "../app/api/content-api";
import { useAuth } from "../app/AuthContext";
import { endLiveSession, getMyActiveSession, type ActiveSession } from "../app/api/live-api";
import { includesQuery, usePagedList } from "../shared/lib/usePagedList";
import { Tabs, TabsList, TabsTrigger } from "../shared/ui/tabs";
import { Button } from "../shared/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "../shared/ui/dialog";
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

import { PaginationBar, SearchField } from "../widgets/ListControls";
import { MaxActiveSessionBanner } from "../widgets/MaxActiveSessionBanner";
import { CourseQuickStart } from "../widgets/CourseQuickStart";
import { CourseContextLinks } from "../widgets/CourseContextLinks";
import { CourseCatalogItem, type CourseCatalogAction } from "../widgets/CourseCatalogItem";

type CourseTab = "active" | "archive";

export function CoursesPage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [showCreate, setShowCreate] = useState(false);
  const createReturnFocus = useRef<HTMLElement | null>(null);
  const [title, setTitle] = useState("");
  const createKey = useRef(new PendingOperationKey());
  const [tab, setTab] = useState<CourseTab>("active");
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [action, setAction] = useState<CourseCatalogAction | null>(null);
  const actionReturnFocus = useRef<HTMLButtonElement | null>(null);
  const canCreateCourse = user?.role === "ADMIN" || user?.role === "LECTURER";
  const activeSession = useQuery({
    queryKey: ["active-session"],
    queryFn: getMyActiveSession,
    enabled: Boolean(user && user.role !== "STUDENT"),
    retry: 1
  });
  const endSessionMut = useMutation({
    mutationFn: (session: ActiveSession) => endLiveSession(session.courseId, session.sessionId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["active-session"] });
      void qc.invalidateQueries({ queryKey: ["live"] });
      toast.success("Занятие завершено");
    },
    onError: (error) => toast.error(userErrorMessage(error, "Не удалось завершить занятие."))
  });
  const {
    data: courses = [],
    isLoading,
    isError
  } = useQuery({ queryKey: ["courses"], queryFn: listCourses });
  const lectureQueries = useQueries({
    queries: courses.map((course) => ({
      queryKey: ["content", course.id, "lectures"],
      queryFn: () => listLectures(course.id),
      staleTime: 30000
    }))
  });
  const lectureByCourse = useMemo(
    () =>
      new Map(
        courses.map((course, index) => [
          course.id,
          lectureQueries[index]?.data?.filter((lecture) => !lecture.archived) ?? []
        ])
      ),
    [courses, lectureQueries]
  );
  const activeCourses = courses.filter((course) => !course.archived);
  const archivedCourses = courses.filter((course) => course.archived);
  const visibleCourses = (tab === "archive" ? archivedCourses : activeCourses).filter(
    (course) =>
      includesQuery(query, course.title) ||
      (lectureByCourse.get(course.id) ?? []).some((lecture) => includesQuery(query, lecture.title))
  );
  const paged = usePagedList(visibleCourses, 20);
  const selectedCourse =
    visibleCourses.find((course) => course.id === selectedId) ?? visibleCourses[0];
  const selectedAccess = useQuery({
    queryKey: ["courses", selectedCourse?.id],
    queryFn: () => getCourse(selectedCourse!.id),
    enabled: Boolean(selectedCourse)
  });
  useEffect(() => {
    if (selectedCourse) setSelectedId(selectedCourse.id);
  }, [selectedCourse]);
  const createMut = useMutation({
    mutationFn: () => {
      const request = { title: title.trim() };
      return createKey.current.run(request, (key) => createCourse(request, key));
    },
    onSuccess: (course) => {
      void qc.invalidateQueries({ queryKey: ["courses"] });
      setTitle("");
      setShowCreate(false);
      setTab("active");
      setQuery("");
      setSelectedId(course.id);
      toast.success("Курс создан");
    },
    onError: (error) => toast.error(userErrorMessage(error, "Не удалось создать курс."))
  });
  const onCourseError = (error: unknown) => toast.error(userErrorMessage(error));
  const archiveMut = useMutation({
    mutationFn: archiveCourse,
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["courses"] }),
    onError: onCourseError
  });
  const restoreMut = useMutation({
    mutationFn: restoreCourse,
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["courses"] }),
    onError: onCourseError
  });
  const hardDeleteMut = useMutation({
    mutationFn: hardDeleteCourse,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["courses"] });
      toast.success("Курс удалён");
    },
    onError: onCourseError
  });
  function submit(event: FormEvent) {
    event.preventDefault();
    if (title.trim().length >= 2) createMut.mutate();
  }
  function openCreate(event: MouseEvent<HTMLButtonElement>) {
    createReturnFocus.current = event.currentTarget;
    setShowCreate(true);
  }
  const currentSession = activeSession.data;
  const blocked = activeSession.isLoading || activeSession.isError || Boolean(currentSession);
  return (
    <div className="page courses-page">
      <header className="page-header courses-page__header">
        <h1>Курсы</h1>
        {canCreateCourse && (
          <Button variant="outline" onClick={openCreate}>
            <Plus aria-hidden="true" />
            <span className="courses-create-label">Создать курс</span>
            <span className="courses-create-label-mobile">Создать</span>
          </Button>
        )}
      </header>
      {activeSession.isError && (
        <div className="courses-session-error" role="alert">
          <span>
            Не удалось проверить активное занятие. Повторите запрос, прежде чем готовить новое.
          </span>
          <Button variant="outline" onClick={() => void activeSession.refetch()}>
            Повторить
          </Button>
        </div>
      )}
      {currentSession && (
        <MaxActiveSessionBanner
          session={currentSession}
          ending={endSessionMut.isPending}
          onEnd={() => endSessionMut.mutate(currentSession)}
        />
      )}
      {isLoading && (
        <div className="catalog-skeleton" role="status" aria-busy="true">
          <span className="sr-only">Загрузка курсов…</span>
          <div />
          <div />
          <div />
        </div>
      )}
      {isError && (
        <div className="courses-list-error" role="alert">
          <p>Не удалось загрузить курсы. Проверьте соединение и повторите запрос.</p>
          <Button
            variant="outline"
            onClick={() => void qc.invalidateQueries({ queryKey: ["courses"] })}
          >
            Повторить
          </Button>
        </div>
      )}
      {!isLoading && !isError && (
        <div className="course-catalog">
          <section className="course-catalog__master" aria-label="Список курсов">
            <SearchField value={query} onChange={setQuery} placeholder="Поиск курсов и лекций" />
            <div className="course-catalog__controls">
              <Tabs value={tab} onValueChange={(value) => setTab(value as CourseTab)}>
                <TabsList>
                  <TabsTrigger value="active">Активные ({activeCourses.length})</TabsTrigger>
                  <TabsTrigger value="archive">Архив ({archivedCourses.length})</TabsTrigger>
                </TabsList>
              </Tabs>
              <span className="muted">{tab === "active" ? "В активных курсах" : "В архиве"}</span>
            </div>
            {query && (
              <p className="course-catalog__search-status" role="status">
                Найдено курсов: {visibleCourses.length}
                {lectureQueries.some((item) => item.isLoading) ? " · Поиск лекций…" : ""}
              </p>
            )}
            {query && lectureQueries.some((item) => item.isError) && (
              <p className="form-error">
                Часть лекций недоступна для поиска.{" "}
                <Button
                  variant="link"
                  onClick={() => {
                    lectureQueries.forEach((item) => {
                      if (item.isError) void item.refetch();
                    });
                  }}
                >
                  Повторить загрузку
                </Button>
              </p>
            )}
            <ul className="course-catalog__list">
              {paged.pageItems.map((course) => {
                const lectures = lectureByCourse.get(course.id) ?? [];
                const loading = lectureQueries[courses.indexOf(course)]?.isLoading;
                const error = lectureQueries[courses.indexOf(course)]?.isError;
                const active = course.id === selectedCourse?.id;
                return (
                  <CourseCatalogItem
                    key={course.id}
                    course={course}
                    lectures={lectures}
                    query={query}
                    active={active}
                    loading={Boolean(loading)}
                    error={Boolean(error)}
                    archiving={archiveMut.isPending}
                    restoring={restoreMut.isPending}
                    deleting={hardDeleteMut.isPending}
                    onSelect={() => {
                      if (window.matchMedia("(max-width: 1099px)").matches)
                        navigate(`/courses/${course.id}`);
                      else setSelectedId(course.id);
                    }}
                    onAction={(next, trigger) => {
                      actionReturnFocus.current = trigger;
                      setAction(next);
                    }}
                    onRestore={(id) => restoreMut.mutate(id)}
                  />
                );
              })}
            </ul>
            {courses.length === 0 && (
              <div className="courses-empty">
                <strong>Курсов пока нет</strong>
                <p className="muted">
                  {canCreateCourse
                    ? "Создайте курс, чтобы добавить лекции и учебные группы."
                    : "Здесь появятся курсы, к которым вам предоставят доступ."}
                </p>
                {canCreateCourse && <Button onClick={openCreate}>Создать курс</Button>}
              </div>
            )}
            {courses.length > 0 && visibleCourses.length === 0 && (
              <p className="muted course-catalog__empty">
                {query
                  ? "Курсы и лекции не найдены. Попробуйте изменить поиск."
                  : tab === "archive"
                    ? "В архиве пока нет курсов."
                    : "Активных курсов пока нет."}
              </p>
            )}
            <PaginationBar {...paged} onPageChange={paged.setPage} />
          </section>
          {selectedCourse && (
            <aside className="course-catalog__detail" aria-label="Выбранный курс">
              <section className="catalog-context">
                <p className="catalog-context__label">Выбранный курс</p>
                <h2>{selectedCourse.title}</h2>
                {selectedCourse.archived ? (
                  <div className="catalog-context__archive">
                    <p className="muted">Курс в архиве. Материалы и история сохранены.</p>
                    {selectedAccess.data?.canManage === true &&
                      !selectedAccess.isError &&
                      !selectedAccess.isFetching && (
                        <Button
                          variant="outline"
                          disabled={restoreMut.isPending}
                          onClick={() => restoreMut.mutate(selectedCourse.id)}
                        >
                          <RotateCcw />
                          Восстановить курс
                        </Button>
                      )}
                  </div>
                ) : (
                  <CourseQuickStart
                    key={selectedCourse.id}
                    courseId={selectedCourse.id}
                    blocked={blocked}
                    preferredLectureId={
                      query.trim()
                        ? lectureByCourse
                            .get(selectedCourse.id)
                            ?.find((lecture) => includesQuery(query, lecture.title))?.id
                        : undefined
                    }
                  />
                )}
              </section>
              <CourseContextLinks
                courseId={selectedCourse.id}
                canManage={selectedAccess.data?.canManage === true}
                includeOpen
              />
            </aside>
          )}
        </div>
      )}
      <Dialog
        open={showCreate}
        onOpenChange={(open) => {
          if (!createMut.isPending) setShowCreate(open);
        }}
      >
        <DialogContent
          onCloseAutoFocus={(event) => {
            if (createReturnFocus.current?.isConnected) {
              event.preventDefault();
              createReturnFocus.current.focus();
            }
          }}
        >
          <DialogHeader>
            <DialogTitle>Создать курс</DialogTitle>
            <DialogDescription>
              Лекции и участников можно добавить после создания.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={submit} className="course-create-form">
            <label className="field">
              <span>Название курса</span>
              <input
                disabled={createMut.isPending}
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="Например, Педагогический дизайн"
                required
                minLength={2}
              />
            </label>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                disabled={createMut.isPending}
                onClick={() => setShowCreate(false)}
              >
                Отмена
              </Button>
              <Button type="submit" disabled={createMut.isPending || title.trim().length < 2}>
                {createMut.isPending ? "Создаём…" : "Создать курс"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <AlertDialog
        open={Boolean(action)}
        onOpenChange={(open) => {
          if (!open) setAction(null);
        }}
      >
        <AlertDialogContent
          onCloseAutoFocus={(event) => {
            const target = actionReturnFocus.current?.isConnected
              ? actionReturnFocus.current
              : document.querySelector<HTMLInputElement>(".course-catalog__master input");
            if (target) {
              event.preventDefault();
              target.focus();
            }
          }}
        >
          <AlertDialogHeader>
            <AlertDialogTitle>
              {action?.kind === "delete" ? "Удалить курс навсегда?" : "Архивировать курс?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              <strong>{action?.title}</strong>
              <br />
              {action?.kind === "delete"
                ? "Курс, материалы, лекции и история будут удалены. Восстановить курс после удаления нельзя."
                : "Курс пропадёт из активной работы, но история и материалы сохранятся. Вы сможете восстановить его из архива."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Отмена</AlertDialogCancel>
            <AlertDialogAction
              className={action?.kind === "delete" ? "ui-button--destructive" : ""}
              onClick={() => {
                if (!action) return;
                if (action.kind === "delete") hardDeleteMut.mutate(action.id);
                else archiveMut.mutate(action.id);
              }}
            >
              {action?.kind === "delete" ? "Удалить навсегда" : "Архивировать"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
