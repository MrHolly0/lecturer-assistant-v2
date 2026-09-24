import { useMemo, useState } from "react";
import type { FormEvent } from "react";
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
import { includesQuery, usePagedList } from "../shared/lib/usePagedList";
import { Tabs, TabsList, TabsTrigger } from "../shared/ui/tabs";
import { ConfirmActionButton } from "../widgets/ConfirmActionButton";
import { PaginationBar, SearchField } from "../widgets/ListControls";

type CourseTab = "active" | "archive";

export function CoursesPage() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const [showCreate, setShowCreate] = useState(false);
  const [title, setTitle] = useState("");
  const [tab, setTab] = useState<CourseTab>("active");
  const [query, setQuery] = useState("");
  const canCreateCourse = user?.role === "ADMIN" || user?.role === "LECTURER";

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

  function submit(e: FormEvent) {
    e.preventDefault();
    createMut.mutate();
  }

  return (
    <div className="page">
      <div className="page-header">
        <h1>Курсы</h1>
        {canCreateCourse && !showCreate && (
          <button className="btn-primary" onClick={() => setShowCreate(true)}>
            + Создать курс
          </button>
        )}
      </div>

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
          <button type="submit" className="btn-primary" disabled={createMut.isPending}>
            Создать
          </button>
          <button type="button" className="btn-ghost" onClick={() => setShowCreate(false)}>
            Отмена
          </button>
        </form>
      )}

      {isLoading && <p className="muted">Загрузка...</p>}
      {isError && <p className="form-error">Не удалось загрузить курсы.</p>}

      {!isLoading && !isError && courses.length === 0 && (
        <p className="muted">Нет курсов. Создайте первый.</p>
      )}

      {!isLoading && !isError && courses.length > 0 && (
        <div className="list-toolbar">
          <Tabs value={tab} onValueChange={(value) => setTab(value as CourseTab)}>
            <TabsList>
              <TabsTrigger value="active">Активные ({activeCourses.length})</TabsTrigger>
              <TabsTrigger value="archive">Архив ({archivedCourses.length})</TabsTrigger>
            </TabsList>
          </Tabs>
          <SearchField value={query} onChange={setQuery} placeholder="Найти курс" />
        </div>
      )}

      {visibleCourses.length > 0 && (
        <ul className="card-list">
          {paged.pageItems.map((course) => (
            <li key={course.id} className="course-card">
              <Link to={`/courses/${course.id}`} className="course-card__main">
                <span className="card-title">{course.title}</span>
                {course.archived && <span className="badge badge--muted">архив</span>}
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
                  <button
                    type="button"
                    className="btn-ghost"
                    disabled={restoreMut.isPending}
                    onClick={() => restoreMut.mutate(course.id)}
                  >
                    Восстановить
                  </button>
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
      <PaginationBar {...paged} onPageChange={paged.setPage} />
    </div>
  );
}
