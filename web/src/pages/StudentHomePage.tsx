import { useMemo, useState } from "react";
import type { FormEvent } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { listCourses } from "../app/api/courses-api";
import { joinLiveSession } from "../app/api/live-api";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "../shared/ui/select";

export function StudentHomePage() {
  const [courseId, setCourseId] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const coursesQuery = useQuery({ queryKey: ["courses"], queryFn: listCourses });
  const courses = useMemo(() => coursesQuery.data ?? [], [coursesQuery.data]);
  const selectedCourseId = courseId || courses[0]?.id || "";

  const joinMut = useMutation({
    mutationFn: () => joinLiveSession(selectedCourseId, joinCode.trim()),
    onSuccess: (session) => {
      setJoinCode("");
      toast.success(`Вы подключены к лекции "${session.lectureTitle}".`);
    }
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!selectedCourseId) {
      toast.error("Сначала нужен курс, куда вас пригласил преподаватель.");
      return;
    }
    joinMut.mutate();
  }

  return (
    <div className="page">
      <div className="page-header">
        <h1>Студенческий кабинет</h1>
        <span className="muted">Подключение к лекции и ваши курсы</span>
      </div>

      <section className="material-section">
        <div className="section-heading">
          <h2>Подключиться к лекции</h2>
          <span className="muted">Введите код с экрана преподавателя</span>
        </div>
        <form onSubmit={submit} className="inline-form">
          {courses.length > 1 && (
            <Select value={selectedCourseId} onValueChange={setCourseId}>
              <SelectTrigger className="inline-select">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {courses.map((course) => (
                  <SelectItem key={course.id} value={course.id}>
                    {course.title}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <input
            value={joinCode}
            onChange={(event) => setJoinCode(event.target.value.toUpperCase())}
            placeholder="Код лекции"
            required
            minLength={4}
          />
          <button
            className="btn-primary"
            type="submit"
            disabled={joinMut.isPending || !joinCode.trim()}
          >
            Подключиться
          </button>
        </form>
      </section>

      <section className="material-section">
        <div className="section-heading">
          <h2>Мои курсы</h2>
          <span className="muted">{courses.length} доступно</span>
        </div>
        {coursesQuery.isLoading && <p className="muted">Загрузка...</p>}
        {coursesQuery.isError && <p className="form-error">Не удалось загрузить курсы.</p>}
        {!coursesQuery.isLoading && courses.length === 0 && (
          <p className="muted">Пока нет курсов. Зарегистрируйтесь по приглашению преподавателя.</p>
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
    </div>
  );
}
