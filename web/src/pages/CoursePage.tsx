import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { components } from '../app/api/schema';
import { createCourseInvitation, createStudyGroup, getCourse } from '../app/api/courses-api';

type CourseRole = 'LECTURER' | 'ASSISTANT' | 'STUDENT';
type Invitation = components['schemas']['Invitation'];

export function CoursePage({ courseId }: { courseId: string }) {
  const qc = useQueryClient();
  const [activeTab, setActiveTab] = useState<'members' | 'groups' | 'invite'>('members');
  const [groupName, setGroupName] = useState('');
  const [inviteRole, setInviteRole] = useState<CourseRole>('STUDENT');
  const [lastInvite, setLastInvite] = useState<Invitation | null>(null);

  const { data: course, isLoading, isError } = useQuery({
    queryKey: ['courses', courseId],
    queryFn: () => getCourse(courseId),
  });

  const createGroupMut = useMutation({
    mutationFn: () => createStudyGroup(courseId, { name: groupName }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['courses', courseId] });
      setGroupName('');
    },
  });

  const inviteMut = useMutation({
    mutationFn: () => createCourseInvitation(courseId, { role: inviteRole, ttlHours: 168 }),
    onSuccess: (inv) => setLastInvite(inv),
  });

  if (isLoading) return <div className="page"><p className="muted">Загрузка...</p></div>;
  if (isError || !course) return <div className="page"><p className="form-error">Курс не найден или нет доступа.</p></div>;

  return (
    <div className="page">
      <div className="page-header">
        <a href="#/courses" className="breadcrumb">← Курсы</a>
        <h1>{course.title}</h1>
        {course.archived && <span className="badge badge--muted">архив</span>}
      </div>

      <div className="tab-row">
        <button
          type="button"
          className={`tab ${activeTab === 'members' ? 'tab--active' : ''}`}
          onClick={() => setActiveTab('members')}
        >
          Участники ({course.members.length})
        </button>
        <button
          type="button"
          className={`tab ${activeTab === 'groups' ? 'tab--active' : ''}`}
          onClick={() => setActiveTab('groups')}
        >
          Группы ({course.groups.length})
        </button>
        <button
          type="button"
          className={`tab ${activeTab === 'invite' ? 'tab--active' : ''}`}
          onClick={() => setActiveTab('invite')}
        >
          Пригласить
        </button>
      </div>

      {activeTab === 'members' && (
        <ul className="member-list">
          {course.members.length === 0 && <li className="muted">Нет участников.</li>}
          {course.members.map((m) => (
            <li key={m.personId} className="member-row">
              <span>{m.displayName}</span>
              <span className={`badge badge--${m.role.toLowerCase()}`}>{m.role}</span>
            </li>
          ))}
        </ul>
      )}

      {activeTab === 'groups' && (
        <>
          <ul className="card-list">
            {course.groups.length === 0 && <li className="muted">Нет групп.</li>}
            {course.groups.map((g) => (
              <li key={g.id} className="card-link">
                <span className="card-title">{g.name}</span>
              </li>
            ))}
          </ul>
          <form
            onSubmit={(e) => { e.preventDefault(); createGroupMut.mutate(); }}
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
            <button type="submit" className="btn-primary" disabled={createGroupMut.isPending}>
              Создать группу
            </button>
          </form>
        </>
      )}

      {activeTab === 'invite' && (
        <div className="invite-panel">
          <label className="field">
            <span>Роль участника</span>
            <select value={inviteRole} onChange={(e) => setInviteRole(e.target.value as CourseRole)}>
              <option value="STUDENT">Студент</option>
              <option value="ASSISTANT">Ассистент</option>
              <option value="LECTURER">Лектор</option>
            </select>
          </label>
          <button
            type="button"
            className="btn-primary"
            onClick={() => { setLastInvite(null); inviteMut.mutate(); }}
            disabled={inviteMut.isPending}
          >
            Сгенерировать код
          </button>
          {lastInvite && (
            <div className="invite-result">
              <code className="invite-code">{lastInvite.code}</code>
              <span className="muted">
                до {new Date(lastInvite.expiresAt).toLocaleDateString('ru-RU')}
              </span>
              <a href={`#/register?code=${lastInvite.code}`} className="btn-ghost">
                Ссылка для регистрации
              </a>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
