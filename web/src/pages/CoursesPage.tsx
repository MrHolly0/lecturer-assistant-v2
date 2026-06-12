import { useState } from "react";
import type { FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import {
  archiveCourse,
  createCourse,
  hardDeleteCourse,
  listCourses,
  restoreCourse
} from "../app/api/courses-api";
import { useAuth } from "../app/AuthContext";
import { ConfirmActionButton } from "../widgets/ConfirmActionButton";

export function CoursesPage() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const [showCreate, setShowCreate] = useState(false);
  const [title, setTitle] = useState("");
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

  const archiveMut = useMutation({
    mutationFn: (courseId: string) => archiveCourse(courseId),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["courses"] })
  });
  const restoreMut = useMutation({
    mutationFn: (courseId: string) => restoreCourse(courseId),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["courses"] })
  });
  const hardDeleteMut = useMutation({
    mutationFn: (courseId: string) => hardDeleteCourse(courseId),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["courses"] })
  });
  const activeCourses = courses.filter((course) => !course.archived);
  const archivedCourses = courses.filter((course) => course.archived);

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

      {activeCourses.length > 0 && (
        <ul className="card-list">
          {activeCourses.map((course) => (
            <li key={course.id}>
              <div className="card-link">
                <Link to={`/courses/${course.id}`} className="card-title">
                  {course.title}
                </Link>
                {canCreateCourse && (
                  <ConfirmActionButton
                    title="Архивировать курс?"
                    description="Курс пропадёт из активной работы, но история и материалы сохранятся."
                    confirmLabel="Архивировать"
                    disabled={archiveMut.isPending}
                    onConfirm={() => archiveMut.mutate(course.id)}
                  >
                    Архив
                  </ConfirmActionButton>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      {archivedCourses.length > 0 && (
        <section className="archive-section">
          <div className="section-heading">
            <h2>Архив</h2>
            <span className="muted">{archivedCourses.length} курсов</span>
          </div>
          <ul className="card-list">
            {archivedCourses.map((course) => (
              <li key={course.id} className="card-link">
                <Link to={`/courses/${course.id}`} className="card-title">
                  {course.title}
                </Link>
                <span className="badge badge--muted">архив</span>
                {canCreateCourse && (
                  <>
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
                  </>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
