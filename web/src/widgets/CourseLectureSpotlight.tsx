import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BookOpenText, Radio, RefreshCw, Square } from "lucide-react";
import { toast } from "sonner";
import { userErrorMessage } from "../app/api/errors";
import { listLectures } from "../app/api/content-api";
import { endLiveSession, getMyActiveSession } from "../app/api/live-api";
import { Button, LinkButton } from "../shared/ui/button";
import { ConfirmActionButton } from "./ConfirmActionButton";
import { CourseQuickStart } from "./CourseQuickStart";
import { SessionGroups } from "./SessionGroups";

export function CourseLectureSpotlight({
  courseId,
  canManage
}: {
  courseId: string;
  canManage: boolean;
}) {
  const queryClient = useQueryClient();
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
        aria-busy="true"
        role="status"
      >
        <div className="course-live-card__skeleton" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
        <span className="sr-only">Загружаем лекцию и состояние занятия…</span>
      </section>
    );
  }

  if (lecturesQuery.isError || activeSessionQuery.isError) {
    return (
      <section className="course-live-card course-live-card--empty" role="alert">
        <div className="course-live-card__copy">
          <span className="course-live-card__status">
            <BookOpenText size={15} /> Лекции
          </span>
          <h2>Не удалось проверить состояние занятия</h2>
          <p>Повторите запрос, прежде чем открыть подключение.</p>
        </div>
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            if (lecturesQuery.isError) void lecturesQuery.refetch();
            if (activeSessionQuery.isError) void activeSessionQuery.refetch();
          }}
        >
          <RefreshCw size={16} aria-hidden="true" /> Повторить
        </Button>
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
            <Radio size={15} />{" "}
            {activeSession.status === "SCHEDULED" ? "Подключение открыто" : "Занятие идёт"}
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
          <h2>Добавьте первую лекцию</h2>
          <p>Добавьте презентацию и свяжите её с лекцией, чтобы запускать занятие отсюда.</p>
        </div>
        <LinkButton className="course-live-card__action" to={`/courses/${courseId}/materials`}>
          Открыть материалы
        </LinkButton>
      </section>
    );
  }

  return (
    <section className="course-live-card" aria-label="Подготовка занятия">
      <CourseQuickStart
        courseId={courseId}
        blocked={Boolean(activeSessionQuery.data)}
        variant="overview"
      />
    </section>
  );
}
