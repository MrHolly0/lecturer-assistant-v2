import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { getLiveSession } from "../app/api/live-api";
import { getCourse } from "../app/api/courses-api";
import { buildMaxJoinUrl } from "../app/max/deepLink";
import { LocalQrCode } from "../widgets/LocalQrCode";
import { LinkButton } from "../shared/ui/button";
import { SessionGroups } from "../widgets/SessionGroups";

interface SessionJoinPageProps {
  courseId: string;
  sessionId: string;
}

export function SessionJoinPage({ courseId, sessionId }: SessionJoinPageProps) {
  const sessionQuery = useQuery({
    queryKey: ["live", courseId, sessionId],
    queryFn: () => getLiveSession(courseId, sessionId)
  });
  const courseQuery = useQuery({
    queryKey: ["courses", courseId],
    queryFn: () => getCourse(courseId)
  });
  const session = sessionQuery.data;
  const code = session?.joinCode ?? "";
  const maxUrl = useMemo(() => buildMaxJoinUrl(code), [code]);

  if (sessionQuery.isLoading) {
    return (
      <main className="session-join-shell session-join-shell--center">
        <Loader2 className="student-spinner" size={24} />
        Загрузка кода подключения…
      </main>
    );
  }

  if (sessionQuery.isError || !session || !code) {
    return (
      <main className="session-join-shell session-join-shell--center">
        <h1>Сессия не найдена</h1>
        <p className="muted">Окно подключения открывается из режима лектора.</p>
      </main>
    );
  }

  return (
    <main className="session-join-shell">
      <header className="session-join-head">
        <span className="muted">Занятие запущено</span>
        <h1>Покажите студентам</h1>
        <div className="session-join-context">
          <strong>{courseQuery.data?.title}</strong>
          <span>{session.lectureTitle}</span>
          <SessionGroups groups={session.groups} />
        </div>
        <strong className="session-join-code">{code}</strong>
        <small className="muted">Наведите камеру телефона и откройте лекцию в MAX.</small>
      </header>
      <section className="session-join-panel">
        {maxUrl ? (
          <JoinTarget
            qr={maxUrl}
            link={maxUrl}
            hint="После входа MAX сразу откроет текущую лекцию."
          />
        ) : (
          <ChannelSoon />
        )}
      </section>
      <div className="session-join-actions">
        <LinkButton to={`/courses/${courseId}/sessions/${sessionId}/presenter`}>
          Перейти к занятию
        </LinkButton>
      </div>
    </main>
  );
}

function JoinTarget({ qr, link, hint }: { qr: string; link: string; hint: string }) {
  return (
    <div className="session-join-target">
      <LocalQrCode value={qr} label="Наведите камеру" />
      <a className="session-join-link" href={link} target="_blank" rel="noreferrer">
        {link}
      </a>
      <p className="muted">{hint}</p>
    </div>
  );
}

function ChannelSoon() {
  return (
    <div className="session-join-soon">
      <strong>MAX-бот не настроен</strong>
      <p className="muted">Укажите имя бота в VITE_MAX_BOT_NAME и перезапустите веб-приложение.</p>
    </div>
  );
}
