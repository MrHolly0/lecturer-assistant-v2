import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import { ArrowRight, Plus } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { userErrorMessage } from "../app/api/errors";
import {
  archiveCourse,
  createCourse,
  hardDeleteCourse,
  listCourses,
  restoreCourse
} from "../app/api/courses-api";
import { useAuth } from "../app/AuthContext";
import { getMyActiveSession } from "../app/api/live-api";
import { useMaxBridge } from "../app/max/context";
import { includesQuery, usePagedList } from "../shared/lib/usePagedList";
import { Tabs, TabsList, TabsTrigger } from "../shared/ui/tabs";
import { Button } from "../shared/ui/button";
import { ConfirmActionButton } from "../widgets/ConfirmActionButton";
import { PaginationBar, SearchField } from "../widgets/ListControls";
import { MaxActiveSessionBanner } from "../widgets/MaxActiveSessionBanner";

type CourseTab = "active" | "archive";

export function CoursesPage() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const { isMax } = useMaxBridge();
  const [showCreate, setShowCreate] = useState(false);
  const [title, setTitle] = useState("");
  const [tab, setTab] = useState<CourseTab>("active");
  const [query, setQuery] = useState("");
  const canCreateCourse = user?.role === "ADMIN" || user?.role === "LECTURER";
  const activeSession = useQuery({
    queryKey: ["active-session"],
    queryFn: getMyActiveSession,
    enabled: Boolean(isMax && user?.role !== "STUDENT"),
    retry: 1
  });

  const {
    data: courses = [],
    isLoading,
    isError
  } = useQuery({
    queryKey: ["courses"],
    queryFn: listCourses
  });

  const createMut = useMutation({
    mutationFn: () => createCourse({ title }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["courses"] });
      setTitle("");
      setShowCreate(false);
    }
  });

  const onCourseError = (error: unknown) => toast.error(userErrorMessage(error));
  const archiveMut = useMutation({
    mutationFn: (courseId: string) => archiveCourse(courseId),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["courses"] }),
    onError: onCourseError
  });
  const restoreMut = useMutation({
    mutationFn: (courseId: string) => restoreCourse(courseId),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["courses"] }),
    onError: onCourseError
  });
  const hardDeleteMut = useMutation({
    mutationFn: (courseId: string) => hardDeleteCourse(courseId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["courses"] });
      toast.success("Курс удалён");
    },
    onError: onCourseError
  });
  const activeCourses = courses.filter((course) => !course.archived);
  const archivedCourses = courses.filter((course) => course.archived);
  const visibleCourses = useMemo(
    () =>
      (tab === "archive" ? archivedCourses : activeCourses).filter((course) =>
        includesQuery(query, course.title)
      ),
    [activeCourses, archivedCourses, query, tab]
  );
  const paged = usePagedList(visibleCourses, 20);
  const showTabs = archivedCourses.length > 0;
  const showSearch = courses.length > 5 || Boolean(query);

  useEffect(() => {
    if (!showTabs && tab === "archive") setTab("active");
  }, [showTabs, tab]);

  function submit(e: FormEvent) {
    e.preventDefault();
    createMut.mutate();
  }

  return (
    <div className="page">
      <div className="page-header">
        <h1>Курсы</h1>
        {canCreateCourse && !showCreate && (
          <Button onClick={() => setShowCreate(true)}>
            <Plus aria-hidden="true" /> Создать курс
          </Button>
        )}
      </div>

      {activeSession.data && <MaxActiveSessionBanner session={activeSession.data} />}

      {canCreateCourse && showCreate && (
        <form onSubmit={submit} className="inline-form">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Название курса"
            required
            minLength={2}
            autoFocus
          />
          <Button type="submit" disabled={createMut.isPending}>
            Создать
          </Button>
          <Button type="button" variant="ghost" onClick={() => setShowCreate(false)}>
            Отмена
          </Button>
        </form>
      )}

      {isLoading && <p className="muted">Загрузка...</p>}
      {isError && <p className="form-error">Не удалось загрузить курсы.</p>}

      {!isLoading && !isError && courses.length === 0 && (
        <p className="muted">Нет курсов. Создайте первый.</p>
      )}

      {!isLoading && !isError && courses.length > 0 && (showTabs || showSearch) && (
        <div className="list-toolbar">
          {showTabs && (
            <Tabs value={tab} onValueChange={(value) => setTab(value as CourseTab)}>
              <TabsList>
                <TabsTrigger value="active">Активные ({activeCourses.length})</TabsTrigger>
                <TabsTrigger value="archive">Архив ({archivedCourses.length})</TabsTrigger>
              </TabsList>
            </Tabs>
          )}
          {showSearch && <SearchField value={query} onChange={setQuery} placeholder="Найти курс" />}
        </div>
      )}

      {visibleCourses.length > 0 && (
        <ul className="card-list">
          {paged.pageItems.map((course) => (
            <li key={course.id} className="course-card">
              <Link to={`/courses/${course.id}`} className="course-card__main">
                <span className="course-card__copy">
                  <span className="card-title">{course.title}</span>
                  <small>Открыть курс и готовые лекции</small>
                </span>
                {course.archived ? (
                  <span className="badge badge--muted">архив</span>
                ) : (
                  <ArrowRight className="course-card__arrow" size={18} aria-hidden="true" />
                )}
              </Link>
              {canCreateCourse && !course.archived && (
                <div className="course-card__actions">
                  <ConfirmActionButton
                    title="Архивировать курс?"
                    description="Курс пропадёт из активной работы, но история и материалы сохранятся."
                    confirmLabel="Архивировать"
                    disabled={archiveMut.isPending}
                    onConfirm={() => archiveMut.mutate(course.id)}
                  >
                    Архив
                  </ConfirmActionButton>
                </div>
              )}
              {canCreateCourse && course.archived && (
                <div className="course-card__actions">
                  <Button
                    type="button"
                    variant="ghost"
                    disabled={restoreMut.isPending}
                    onClick={() => restoreMut.mutate(course.id)}
                  >
                    Восстановить
                  </Button>
                  <ConfirmActionButton
                    title="Удалить курс навсегда?"
                    description="Курс, материалы, лекции и история будут удалены."
                    confirmLabel="Удалить навсегда"
                    disabled={hardDeleteMut.isPending}
                    onConfirm={() => hardDeleteMut.mutate(course.id)}
                  >
                    Удалить навсегда
                  </ConfirmActionButton>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {!isLoading && !isError && courses.length > 0 && visibleCourses.length === 0 && (
        <p className="muted">Ничего не найдено.</p>
      )}
      {paged.pageCount > 1 && <PaginationBar {...paged} onPageChange={paged.setPage} />}
    </div>
  );
}
