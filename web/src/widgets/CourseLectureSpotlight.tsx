import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BookOpenText, Play, Radio, Square } from "lucide-react";
import { toast } from "sonner";
import { userErrorMessage } from "../app/api/errors";
import { listLectures } from "../app/api/content-api";
import { endLiveSession, getMyActiveSession } from "../app/api/live-api";
import { Button, LinkButton } from "../shared/ui/button";
import { ConfirmActionButton } from "./ConfirmActionButton";
import { StartSessionDialog } from "./StartSessionDialog";
import { SessionGroups } from "./SessionGroups";

export function CourseLectureSpotlight({
  courseId,
  canManage
}: {
  courseId: string;
  canManage: boolean;
}) {
  const queryClient = useQueryClient();
  const [startOpen, setStartOpen] = useState(false);
  const lecturesQuery = useQuery({
    queryKey: ["content", courseId, "lectures"],
    queryFn: () => listLectures(courseId)
  });
  const activeSessionQuery = useQuery({
    queryKey: ["active-session"],
    queryFn: getMyActiveSession,
    retry: 1
  });
  const firstLecture = lecturesQuery.data?.find((lecture) => !lecture.archived);
  const activeSession =
    activeSessionQuery.data?.courseId === courseId ? activeSessionQuery.data : null;
  const endMutation = useMutation({
    mutationFn: (sessionId: string) => endLiveSession(courseId, sessionId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["active-session"] });
      void queryClient.invalidateQueries({ queryKey: ["live"] });
      toast.success("Занятие завершено");
    },
    onError: (error) => toast.error(userErrorMessage(error, "Не удалось завершить лекцию."))
  });

  if (lecturesQuery.isLoading || activeSessionQuery.isLoading) {
    return (
      <section
        className="course-live-card course-live-card--loading"
        aria-label="Загрузка лекции"
      />
    );
  }

  if (lecturesQuery.isError || activeSessionQuery.isError) {
    return (
      <section className="course-live-card course-live-card--empty" role="alert">
        <div className="course-live-card__copy">
          <span className="course-live-card__status">
            <BookOpenText size={15} /> Лекции
          </span>
          <h2>Не удалось загрузить готовую лекцию</h2>
          <p>Откройте материалы курса или обновите страницу.</p>
        </div>
        <LinkButton
          variant="outline"
          className="course-live-card__action"
          to={`/courses/${courseId}/materials`}
        >
          Открыть материалы
        </LinkButton>
      </section>
    );
  }

  if (activeSession) {
    return (
      <section className="course-live-card course-live-card--active">
        <div className="course-live-card__copy">
          <span className="course-live-card__status course-live-card__status--live">
            <Radio size={15} /> Занятие идёт
          </span>
          <h2>{activeSession.lectureTitle}</h2>
          <SessionGroups groups={activeSession.groups} compact />
          <p>Вернитесь к слайдам и реакции аудитории.</p>
        </div>
        <div className="course-live-card__actions">
          <LinkButton
            className="course-live-card__action"
            to={`/courses/${courseId}/sessions/${activeSession.sessionId}/presenter`}
          >
            Продолжить занятие
          </LinkButton>
          {canManage && (
            <ConfirmActionButton
              title="Завершить текущее занятие?"
              description="Сигналы и ответы перестанут приниматься. После завершения будет доступен итог занятия."
              confirmLabel="Завершить"
              variant="outline"
              disabled={endMutation.isPending}
              onConfirm={() => endMutation.mutate(activeSession.sessionId)}
            >
              <Square size={15} aria-hidden="true" />
              Завершить
            </ConfirmActionButton>
          )}
        </div>
      </section>
    );
  }

  if (!firstLecture) {
    return (
      <section className="course-live-card course-live-card--empty">
        <div className="course-live-card__copy">
          <span className="course-live-card__status">
            <BookOpenText size={15} /> Нет готовых лекций
          </span>
          <h2>Подготовьте первую лекцию</h2>
          <p>Добавьте презентацию и свяжите её с лекцией, чтобы запускать занятие отсюда.</p>
        </div>
        <LinkButton className="course-live-card__action" to={`/courses/${courseId}/materials`}>
          Подготовить лекцию
        </LinkButton>
      </section>
    );
  }

  return (
    <section className="course-live-card">
      <div className="course-live-card__copy">
        <span className="course-live-card__status">
          <BookOpenText size={15} /> Готова к запуску
        </span>
        <h2>{firstLecture.title}</h2>
        <p>
          {firstLecture.deckTitle} · версия {firstLecture.deckVersion}
        </p>
      </div>
      <div className="course-live-card__actions">
        {canManage && (
          <Button
            type="button"
            className="course-live-card__action"
            onClick={() => setStartOpen(true)}
          >
            <Play size={17} aria-hidden="true" />
            Запустить занятие
          </Button>
        )}
        <LinkButton
          variant="ghost"
          className="course-live-card__secondary"
          to={`/courses/${courseId}/materials`}
        >
          Все лекции
        </LinkButton>
      </div>
      <StartSessionDialog
        courseId={courseId}
        lecture={firstLecture}
        open={startOpen}
        onOpenChange={setStartOpen}
      />
    </section>
  );
}
