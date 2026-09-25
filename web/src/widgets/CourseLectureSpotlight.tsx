import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BookOpenText, Play, Radio } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { userErrorMessage } from "../app/api/errors";
import { listLectures } from "../app/api/content-api";
import { getMyActiveSession, startLiveSession } from "../app/api/live-api";
import { Button, LinkButton } from "../shared/ui/button";

export function CourseLectureSpotlight({
  courseId,
  canManage
}: {
  courseId: string;
  canManage: boolean;
}) {
  const navigate = useNavigate();
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
  const startMutation = useMutation({
    mutationFn: (lectureId: string) => startLiveSession(courseId, lectureId),
    onSuccess: (session) => {
      void queryClient.invalidateQueries({ queryKey: ["active-session"] });
      navigate(`/courses/${courseId}/sessions/${session.id}/join`);
    },
    onError: (error) =>
      toast.error(userErrorMessage(error, "Не удалось запустить лекцию."))
  });

  if (lecturesQuery.isLoading || activeSessionQuery.isLoading) {
    return <section className="course-live-card course-live-card--loading" aria-label="Загрузка лекции" />;
  }

  if (lecturesQuery.isError || activeSessionQuery.isError) {
    return (
      <section className="course-live-card course-live-card--empty" role="alert">
        <div className="course-live-card__copy">
          <span className="course-live-card__status"><BookOpenText size={15} /> Лекции</span>
          <h2>Не удалось загрузить готовую лекцию</h2>
          <p>Откройте материалы курса или обновите страницу.</p>
        </div>
        <LinkButton variant="outline" className="course-live-card__action" to={`/courses/${courseId}/materials`}>
          Открыть материалы
        </LinkButton>
      </section>
    );
  }

  if (activeSession) {
    return (
      <section className="course-live-card course-live-card--active">
        <div className="course-live-card__copy">
          <span className="course-live-card__status course-live-card__status--live"><Radio size={15} /> Лекция идёт</span>
          <h2>{activeSession.lectureTitle}</h2>
          <p>Вернитесь к слайдам и реакции аудитории.</p>
        </div>
        <LinkButton
          className="course-live-card__action"
          to={`/courses/${courseId}/sessions/${activeSession.sessionId}/presenter`}
        >
          Продолжить лекцию
        </LinkButton>
      </section>
    );
  }

  if (!firstLecture) {
    return (
      <section className="course-live-card course-live-card--empty">
        <div className="course-live-card__copy">
          <span className="course-live-card__status"><BookOpenText size={15} /> Нет готовых лекций</span>
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
        <span className="course-live-card__status"><BookOpenText size={15} /> Готова к запуску</span>
        <h2>{firstLecture.title}</h2>
        <p>{firstLecture.deckTitle} · версия {firstLecture.deckVersion}</p>
      </div>
      <div className="course-live-card__actions">
        {canManage && (
          <Button
            type="button"
            className="course-live-card__action"
            disabled={startMutation.isPending}
            onClick={() => startMutation.mutate(firstLecture.id)}
          >
            <Play size={17} aria-hidden="true" />
            {startMutation.isPending ? "Запускаем…" : "Начать лекцию"}
          </Button>
        )}
        <LinkButton variant="ghost" className="course-live-card__secondary" to={`/courses/${courseId}/materials`}>
          Все лекции
        </LinkButton>
      </div>
    </section>
  );
}
