import { useState } from 'react';
import type { FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createCourse, listCourses } from '../app/api/courses-api';

export function CoursesPage() {
  const qc = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [title, setTitle] = useState('');

  const { data: courses = [], isLoading, isError } = useQuery({
    queryKey: ['courses'],
    queryFn: listCourses,
  });

  const createMut = useMutation({
    mutationFn: () => createCourse({ title }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['courses'] });
      setTitle('');
      setShowCreate(false);
    },
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    createMut.mutate();
  }

  return (
    <div className="page">
      <div className="page-header">
        <h1>Курсы</h1>
        {!showCreate && (
          <button className="btn-primary" onClick={() => setShowCreate(true)}>
            + Создать курс
          </button>
        )}
      </div>

      {showCreate && (
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

      {courses.length > 0 && (
        <ul className="card-list">
          {courses.map((course) => (
            <li key={course.id}>
              <a href={`#/courses/${course.id}`} className="card-link">
                <span className="card-title">{course.title}</span>
                {course.archived && <span className="badge badge--muted">архив</span>}
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
