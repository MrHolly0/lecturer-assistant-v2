import { useEffect, useMemo, useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, CircleStop, Loader2, Play } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { beginLiveSession, endLiveSession } from "../app/api/live-api";
import { useLiveSession } from "../app/live/useLiveSession";
import { TeacherRemoteConnection } from "../widgets/TeacherRemoteConnection";
import { getCourse } from "../app/api/courses-api";
import { userErrorMessage } from "../app/api/errors";
import { buildMaxJoinUrl } from "../app/max/deepLink";
import { useMaxBridge } from "../app/max/context";
import { isMobileMax, teacherRemotePath } from "../app/max/navigation";
import { LocalQrCode } from "../widgets/LocalQrCode";
import { AppHeader } from "../widgets/Layout";
import { Button, LinkButton } from "../shared/ui/button";
import { SessionGroups } from "../widgets/SessionGroups";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger
} from "../shared/ui/alert-dialog";

interface SessionJoinPageProps {
  courseId: string;
  sessionId: string;
}

export function SessionJoinPage(props: SessionJoinPageProps) {
  return (
    <>
      <AppHeader />
      <SessionJoinWorkspace {...props} />
    </>
  );
}

function SessionJoinWorkspace({ courseId, sessionId }: SessionJoinPageProps) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const maxEnvironment = useMaxBridge();
  const live = useLiveSession(courseId, sessionId);
  const courseQuery = useQuery({
    queryKey: ["courses", courseId],
    queryFn: () => getCourse(courseId)
  });
  const session = live.session;
  const commandsBlocked = live.commandsBlocked;
  const code = session?.joinCode ?? "";
  const maxUrl = useMemo(() => buildMaxJoinUrl(code), [code]);
  const presenterPath = isMobileMax(maxEnvironment)
    ? teacherRemotePath(courseId, sessionId)
    : `/courses/${courseId}/sessions/${sessionId}/presenter`;
  const sawScheduled = useRef(false);

  useEffect(() => {
    if (session?.status === "SCHEDULED") sawScheduled.current = true;
    if (session?.status === "LIVE" && sawScheduled.current) {
      navigate(presenterPath, { replace: true });
    }
  }, [navigate, presenterPath, session?.status]);
  const beginMutation = useMutation({
    mutationFn: () => beginLiveSession(courseId, sessionId),
    onSuccess: (started) => {
      live.setSession(started);
      void queryClient.invalidateQueries({ queryKey: ["active-session"] });
      navigate(presenterPath, { replace: true });
      toast.success("Показ начался.");
    },
    onError: (error) => toast.error(userErrorMessage(error, "Не удалось начать показ."))
  });
  const cancelMutation = useMutation({
    mutationFn: () => endLiveSession(courseId, sessionId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["active-session"] });
      navigate(`/courses/${courseId}`, { replace: true });
      toast.success("Занятие отменено.");
    },
    onError: (error) => toast.error(userErrorMessage(error, "Не удалось отменить занятие."))
  });

  if (live.isLoading) {
    return (
      <main className="session-join-shell session-join-shell--center">
        <Loader2 className="student-spinner" size={24} />
        Загрузка кода подключения…
      </main>
    );
  }

  if (!session || !code) {
    return (
      <main className="session-join-shell session-join-shell--center">
        <h1>Сессия не найдена</h1>
        <p className="muted">Проверьте связь. Окно подключения открывается из режима лектора.</p>
        <Button type="button" variant="outline" onClick={() => void live.refresh()}>
          Повторить
        </Button>
      </main>
    );
  }

  if (session.status === "ENDED" || session.status === "ARCHIVED") {
    return (
      <main className="session-join-shell session-join-shell--center">
        <CircleStop size={40} aria-hidden="true" />
        <h1>Занятие завершено</h1>
        <LinkButton to={`/courses/${courseId}`}>Вернуться к курсу</LinkButton>
      </main>
    );
  }

  const scheduled = session.status === "SCHEDULED";

  return (
    <main id="main-content" className="session-join-shell">
      <header className="session-join-head">
        <LinkButton to={`/courses/${courseId}`} variant="ghost" className="session-join-back">
          <ArrowLeft size={16} aria-hidden="true" />К курсу
        </LinkButton>
        <h1>{session.lectureTitle}</h1>
        <div className="session-join-context">
          <span className="session-join-course">{courseQuery.data?.title}</span>
          <span className="session-join-state">
            {scheduled
              ? "Подключение открыто"
              : session.status === "PAUSED"
                ? "Показ на паузе"
                : "Занятие идёт"}
          </span>
        </div>
      </header>
      {commandsBlocked && (
        <TeacherRemoteConnection
          state={live.connection}
          syncing={live.syncing}
          syncedAt={live.syncedAt}
          syncError={live.syncError}
          onRetry={live.refresh}
        />
      )}
      <div className="session-join-layout">
        <section className="session-join-codeblock">
          <h2>Подключите студентов</h2>
          <p className="muted">
            {scheduled
              ? "Код создан. Показ ещё не начался."
              : "Покажите QR-код или продиктуйте код занятия."}
          </p>
          <span className="muted">Код занятия</span>
          <strong className="session-join-code">{code}</strong>
          <SessionGroups groups={session.groups} compact />
        </section>
        <section className="session-join-panel">
          {maxUrl ? (
            <JoinTarget qr={maxUrl} link={maxUrl} hint="Открыть занятие в MAX" />
          ) : (
            <ChannelSoon />
          )}
        </section>
      </div>
      <div className="session-join-actions">
        {scheduled ? (
          <>
            <Button
              type="button"
              size="lg"
              disabled={commandsBlocked || beginMutation.isPending || cancelMutation.isPending}
              onClick={() => beginMutation.mutate()}
            >
              <Play size={18} aria-hidden="true" />
              {beginMutation.isPending ? "Начинаем…" : "Начать показ"}
            </Button>
            <div className="session-join-actions__secondary">
              <LinkButton to={`/courses/${courseId}`} variant="outline">
                Вернуться к курсу
              </LinkButton>
              <CancelScheduledSession
                pending={commandsBlocked || cancelMutation.isPending}
                onConfirm={() => {
                  if (!commandsBlocked) cancelMutation.mutate();
                }}
              />
            </div>
          </>
        ) : (
          <LinkButton to={presenterPath}>Открыть занятие</LinkButton>
        )}
      </div>
    </main>
  );
}

function CancelScheduledSession({
  pending,
  onConfirm
}: {
  pending: boolean;
  onConfirm: () => void;
}) {
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button type="button" variant="ghost" disabled={pending}>
          Отменить занятие
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Отменить занятие до начала?</AlertDialogTitle>
          <AlertDialogDescription>
            Ссылка студентов перестанет работать. Запись занятия останется как отмененная.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Оставить</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm}>Отменить занятие</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
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
      <strong>Подключение через MAX пока не настроено.</strong>
      <p className="muted">Обратитесь к администратору.</p>
    </div>
  );
}
