import { useMemo, useState } from "react";
import type { FormEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { useAuth } from "../app/AuthContext";
import { listCourses } from "../app/api/courses-api";
import { Button } from "../shared/ui/button";

export function StudentHomePage({ joinOnly = false }: { joinOnly?: boolean }) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [joinCode, setJoinCode] = useState("");
  const coursesQuery = useQuery({
    queryKey: ["courses"],
    queryFn: listCourses,
    enabled: Boolean(user) && !joinOnly
  });
  const courses = useMemo(() => coursesQuery.data ?? [], [coursesQuery.data]);

  function submit(event: FormEvent) {
    event.preventDefault();
    const code = joinCode.trim().toUpperCase();
    if (!code) {
      toast.error("Введите код лекции.");
      return;
    }
    navigate(`/s/${encodeURIComponent(code)}`);
  }

  return (
    <div className="page">
      <div className="page-header">
        <h1>{joinOnly ? "Другое занятие" : "Студенческий кабинет"}</h1>
        <span className="muted">
          {joinOnly || !user
            ? "Введите код занятия с экрана преподавателя. Вход в аккаунт не нужен."
            : "Подключение к лекции и ваши курсы"}
        </span>
      </div>

      <section className="material-section">
        <div className="section-heading">
          <h2>Подключиться к лекции</h2>
          <span className="muted">Введите код с экрана преподавателя</span>
        </div>
        <form onSubmit={submit} className="inline-form">
          <input
            value={joinCode}
            onChange={(event) => setJoinCode(event.target.value.toUpperCase())}
            placeholder="Код лекции"
            required
            minLength={4}
          />
          <Button type="submit" disabled={!joinCode.trim()}>
            Подключиться
          </Button>
        </form>
      </section>

      {user && !joinOnly && (
        <section className="material-section">
          <div className="section-heading">
            <h2>Мои курсы</h2>
            <span className="muted">{courses.length} доступно</span>
          </div>
          {coursesQuery.isLoading && <p className="muted">Загрузка...</p>}
          {coursesQuery.isError && <p className="form-error">Не удалось загрузить курсы.</p>}
          {!coursesQuery.isLoading && courses.length === 0 && (
            <p className="muted">
              Пока нет курсов. Зарегистрируйтесь по приглашению преподавателя.
            </p>
          )}
          {courses.length > 0 && (
            <ul className="card-list">
              {courses.map((course) => (
                <li key={course.id} className="card-link">
                  <span className="card-title">{course.title}</span>
                  {course.archived && <span className="badge badge--muted">архив</span>}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}
