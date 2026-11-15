import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Pause, Play } from "lucide-react";
import { getStudentCabinet, type CabinetSession } from "../app/api/student-cabinet";
import { Button, LinkButton } from "../shared/ui/button";

function date(value: string | null): string {
  return value
    ? new Intl.DateTimeFormat("ru-RU", {
        day: "numeric",
        month: "long",
        hour: "2-digit",
        minute: "2-digit"
      }).format(new Date(value))
    : "Время не зафиксировано";
}

function SessionRow({ session, history = false }: { session: CabinetSession; history?: boolean }) {
  return (
    <li className="student-cabinet-session">
      <div className="student-cabinet-session__body">
        <div className="student-cabinet-session__meta">
          <span>{session.courseTitle}</span>
          {session.groups && <span>{session.groups}</span>}
        </div>
        <h3>{session.title}</h3>
        <p className="muted">
          {history
            ? date(session.joinedAt)
            : session.status === "PAUSED"
              ? "Показ на паузе"
              : "Занятие идёт"}
          {history && session.status === "ENDED" ? " · Завершено" : ""}
          {history && session.leftAt && !session.joined ? " · Вы вышли" : ""}
        </p>
      </div>
      {session.joinCode && (
        <LinkButton
          to={`/s/${encodeURIComponent(session.joinCode)}`}
          variant={history ? "outline" : "default"}
        >
          {session.status === "PAUSED" ? <Pause aria-hidden="true" /> : <Play aria-hidden="true" />}
          {session.joinedAt ? "Вернуться" : "Подключиться"}
        </LinkButton>
      )}
    </li>
  );
}

export function StudentCabinetSessions() {
  const [offset, setOffset] = useState(0);
  const query = useQuery({
    queryKey: ["student-cabinet", offset],
    queryFn: () => getStudentCabinet(offset),
    refetchInterval: 30_000,
    refetchOnWindowFocus: true
  });
  const cabinet = query.data;
  if (query.isLoading)
    return (
      <p className="muted" role="status">
        Ищем занятия ваших групп…
      </p>
    );
  if (query.isError && !cabinet) {
    return (
      <div className="form-error" role="alert">
        Не удалось получить занятия. Можно подключиться по коду или повторить поиск.
        <Button variant="outline" onClick={() => void query.refetch()}>
          Повторить
        </Button>
      </div>
    );
  }
  if (!cabinet) return null;
  return (
    <div className="student-cabinet-sessions">
      <section aria-labelledby="student-live-lessons">
        <div className="section-heading">
          <h2 id="student-live-lessons">Сейчас у ваших групп</h2>
        </div>
        {cabinet.ongoing.length ? (
          <ul className="student-cabinet-session-list">
            {cabinet.ongoing.map((session) => (
              <SessionRow key={session.sessionId} session={session} />
            ))}
          </ul>
        ) : (
          <p className="muted">
            Текущих занятий пока нет. Для первого подключения введите код преподавателя.
          </p>
        )}
        {cabinet.moreOngoing && (
          <p className="muted">
            Показаны первые 100 занятий. К нужному можно подключиться по коду.
          </p>
        )}
      </section>
      <section aria-labelledby="student-lesson-history">
        <div className="section-heading">
          <h2 id="student-lesson-history">Вы посещали</h2>
        </div>
        {cabinet.history.length ? (
          <ul className="student-cabinet-session-list">
            {cabinet.history.map((session) => (
              <SessionRow key={session.sessionId} session={session} history />
            ))}
          </ul>
        ) : (
          <p className="muted">
            Здесь появятся занятия, к которым вы подключались с этим аккаунтом.
          </p>
        )}
        {cabinet.historyTotal > 20 && (
          <div className="student-cabinet-pagination">
            <Button
              variant="outline"
              disabled={offset === 0 || query.isFetching}
              onClick={() => setOffset(Math.max(0, offset - 20))}
            >
              Назад
            </Button>
            <span>
              {offset + 1}–{Math.min(offset + 20, cabinet.historyTotal)} из {cabinet.historyTotal}
            </span>
            <Button
              variant="outline"
              disabled={offset + 20 >= cabinet.historyTotal || query.isFetching}
              onClick={() => setOffset(offset + 20)}
            >
              Дальше <ArrowRight aria-hidden="true" />
            </Button>
          </div>
        )}
      </section>
    </div>
  );
}
