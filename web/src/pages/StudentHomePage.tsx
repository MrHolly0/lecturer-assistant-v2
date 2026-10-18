import { useMemo, useState } from "react";
import type { FormEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { useAuth } from "../app/AuthContext";
import { useMaxBridge } from "../app/max/context";
import { listCourses } from "../app/api/courses-api";
import { AppHeader } from "../widgets/Layout";
import { Button } from "../shared/ui/button";

export function StudentHomePage({ joinOnly = false }: { joinOnly?: boolean }) {
  const navigate = useNavigate();
  const { user, maxSignedOut, continueMaxAuth } = useAuth();
  const { isMax, initData } = useMaxBridge();
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
    if (isMax && initData && !user && !maxSignedOut) continueMaxAuth();
    navigate(`/s/${encodeURIComponent(code)}`);
  }

  return (
    <>
      {joinOnly && <AppHeader />}
      <div id={joinOnly ? "main-content" : undefined} className="page student-home">
        <div className="page-header">
          <h1>{joinOnly ? "Подключиться к лекции" : "Студенческий кабинет"}</h1>
          <span className="muted">
            {joinOnly || !user
              ? "Введите код занятия с экрана преподавателя. Вход в аккаунт не нужен."
              : "Подключение к лекции и ваши курсы"}
          </span>
        </div>

        <div className="student-home-join">
          <section className="student-home-join-panel">
            {!joinOnly && (
              <div className="student-home-join-heading">
                <h2>Подключиться к лекции</h2>
                <span className="muted">Введите код с экрана преподавателя</span>
              </div>
            )}
            <form onSubmit={submit} className="inline-form">
              <input
                aria-label="Код занятия"
                autoCapitalize="characters"
                autoComplete="off"
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
          <p className="student-home-help muted">
            Код занятия показывает преподаватель.
            <br />
            После подключения вы сможете задавать вопросы и отвечать на проверки.
          </p>
        </div>

        {user && !joinOnly && (
          <section className="student-home-courses">
            <div className="section-heading">
              <h2>Мои курсы</h2>
              <span className="muted">{courses.length} доступно</span>
            </div>
            {coursesQuery.isLoading && <p className="muted">Загрузка...</p>}
            {coursesQuery.isError && (
              <div className="form-error" role="alert">
                Не удалось загрузить курсы.{" "}
                <Button type="button" variant="outline" onClick={() => void coursesQuery.refetch()}>
                  Повторить
                </Button>
              </div>
            )}
            {!coursesQuery.isLoading && !coursesQuery.isError && courses.length === 0 && (
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
    </>
  );
}
