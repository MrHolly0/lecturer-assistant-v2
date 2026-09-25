import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CircleStop, Loader2, Play } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { beginLiveSession, endLiveSession, getLiveSession } from "../app/api/live-api";
import { getCourse } from "../app/api/courses-api";
import { userErrorMessage } from "../app/api/errors";
import { buildMaxJoinUrl } from "../app/max/deepLink";
import { useMaxBridge } from "../app/max/context";
import { isMobileMax, teacherRemotePath } from "../app/max/navigation";
import { LocalQrCode } from "../widgets/LocalQrCode";
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

export function SessionJoinPage({ courseId, sessionId }: SessionJoinPageProps) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const maxEnvironment = useMaxBridge();
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
  const presenterPath = isMobileMax(maxEnvironment)
    ? teacherRemotePath(courseId, sessionId)
    : `/courses/${courseId}/sessions/${sessionId}/presenter`;
  const beginMutation = useMutation({
    mutationFn: () => beginLiveSession(courseId, sessionId),
    onSuccess: (started) => {
      queryClient.setQueryData(["live", courseId, sessionId], started);
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
    <main className="session-join-shell">
      <header className="session-join-head">
        <span className="muted">{scheduled ? "Ожидание начала" : "Занятие идет"}</span>
        <h1>Покажите студентам</h1>
        <div className="session-join-context">
          <strong>{courseQuery.data?.title}</strong>
          <span>{session.lectureTitle}</span>
          <SessionGroups groups={session.groups} />
        </div>
        <strong className="session-join-code">{code}</strong>
        <small className="muted">
          {scheduled
            ? "Студенты могут подключиться заранее. Показ начнется только по вашей команде."
            : "Наведите камеру телефона и откройте лекцию в MAX."}
        </small>
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
        {scheduled ? (
          <>
            <Button
              type="button"
              size="lg"
              disabled={beginMutation.isPending || cancelMutation.isPending}
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
                pending={cancelMutation.isPending}
                onConfirm={() => cancelMutation.mutate()}
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
      <strong>MAX-бот не настроен</strong>
      <p className="muted">Укажите имя бота в VITE_MAX_BOT_NAME и перезапустите веб-приложение.</p>
    </div>
  );
}
