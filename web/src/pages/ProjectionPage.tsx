import { useEffect, useMemo, useState } from "react";
import { CirclePause, CircleStop } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import {
  connectStudentSession,
  getPublicStudentSession,
  type StudentSessionSnapshot
} from "../app/api/student-api";
import { DrawingOverlay, type LiveAnnotations } from "../widgets/DrawingOverlay";
import { LocalQrCode } from "../widgets/LocalQrCode";
import { buildMaxJoinUrl } from "../app/max/deepLink";
import { BrandMark } from "../shared/brand/BrandMark";
import { SessionGroups } from "../widgets/SessionGroups";

/** Экран показа использует только доступное студентам состояние лекции. */
export function ProjectionPage({ joinCode }: { joinCode: string }) {
  const code = joinCode.trim().toUpperCase();
  const [liveSnapshot, setLiveSnapshot] = useState<StudentSessionSnapshot | null>(null);
  const sessionQuery = useQuery({
    queryKey: ["projection", code],
    queryFn: () => getPublicStudentSession(code),
    enabled: Boolean(code),
    retry: 1
  });
  const session = liveSnapshot ?? sessionQuery.data;
  const joinUrl = useMemo(() => buildMaxJoinUrl(code), [code]);

  useEffect(() => {
    setLiveSnapshot(null);
    if (!code) return;
    const connection = connectStudentSession(code, "", setLiveSnapshot, () => undefined);
    return () => connection.disconnect();
  }, [code]);

  useEffect(() => {
    if (session?.status !== "ENDED" && session?.status !== "ARCHIVED") return;
    if (!window.opener) return;
    const timer = window.setTimeout(() => window.close(), 350);
    return () => window.clearTimeout(timer);
  }, [session?.status]);

  if (sessionQuery.isError && !session) {
    return (
      <main className="projection-shell projection-fallback">
        <h1>Не удалось открыть проектор</h1>
        <p>Проверьте ссылку и подключение к сети.</p>
      </main>
    );
  }
  if (session?.status === "ENDED" || session?.status === "ARCHIVED") {
    return (
      <main className="projection-shell projection-fallback">
        <CircleStop size={48} aria-hidden="true" />
        <h1>Лекция завершена</h1>
        <p>Экран показа можно закрыть.</p>
      </main>
    );
  }
  if (!session?.currentSlide) {
    return <main className="projection-shell">Загрузка показа…</main>;
  }

  return (
    <main className="projection-shell">
      <img src={session.currentSlide.imageUrl} alt={`Слайд ${session.currentSlideIdx}`} />
      <DrawingOverlay
        slideIdx={session.currentSlideIdx}
        annotations={session.annotations as LiveAnnotations}
        active={false}
        onChange={() => undefined}
      />
      {session.status === "PAUSED" && (
        <div className="projection-pause-banner" role="status">
          <CirclePause size={24} aria-hidden="true" />
          Показ приостановлен
        </div>
      )}
      {session.status === "SCHEDULED" && (
        <div className="projection-code">
          <span>Код подключения</span>
          <strong>{session.joinCode}</strong>
          <SessionGroups groups={session.groups} compact />
          {joinUrl ? (
            <div className="projection-qr-lockup">
              <div className="projection-brand">
                <BrandMark />
                <span>Lecturer Assistant</span>
              </div>
              <LocalQrCode value={joinUrl} label="Открыть лекцию в MAX" />
            </div>
          ) : (
            <small>MAX-бот не настроен</small>
          )}
        </div>
      )}
    </main>
  );
}
