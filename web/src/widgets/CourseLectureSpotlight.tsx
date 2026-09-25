import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, BookOpenText, Play, Radio } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { userErrorMessage } from "../app/api/errors";
import { listLectures } from "../app/api/content-api";
import { getMyActiveSession, startLiveSession } from "../app/api/live-api";

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
          <span className="course-live-card__eyebrow"><BookOpenText size={15} /> Лекции</span>
          <h2>Не удалось загрузить готовую лекцию</h2>
          <p>Откройте материалы курса или обновите страницу.</p>
        </div>
        <Link className="btn-ghost course-live-card__action" to={`/courses/${courseId}/materials`}>
          Открыть материалы
        </Link>
      </section>
    );
  }

  if (activeSession) {
    return (
      <section className="course-live-card course-live-card--active">
        <div className="course-live-card__copy">
          <span className="course-live-card__eyebrow"><Radio size={15} /> Лекция идёт</span>
          <h2>{activeSession.lectureTitle}</h2>
          <p>Вернитесь к слайдам и реакции аудитории.</p>
        </div>
        <Link
          className="btn-primary course-live-card__action"
          to={`/courses/${courseId}/sessions/${activeSession.sessionId}/presenter`}
        >
          Продолжить лекцию <ArrowRight size={17} aria-hidden="true" />
        </Link>
      </section>
    );
  }

  if (!firstLecture) {
    return (
      <section className="course-live-card course-live-card--empty">
        <div className="course-live-card__copy">
          <span className="course-live-card__eyebrow"><BookOpenText size={15} /> Следующий шаг</span>
          <h2>Подготовьте первую лекцию</h2>
          <p>Добавьте презентацию и свяжите её с лекцией, чтобы запускать занятие отсюда.</p>
        </div>
        <Link className="btn-primary course-live-card__action" to={`/courses/${courseId}/materials`}>
          Подготовить лекцию <ArrowRight size={17} aria-hidden="true" />
        </Link>
      </section>
    );
  }

  return (
    <section className="course-live-card">
      <div className="course-live-card__copy">
        <span className="course-live-card__eyebrow"><BookOpenText size={15} /> Готова к запуску</span>
        <h2>{firstLecture.title}</h2>
        <p>{firstLecture.deckTitle} · версия {firstLecture.deckVersion}</p>
        <div className="course-live-signals" aria-label="На лекции доступны сигналы понимания">
          <span className="course-live-signals__green">Понятно</span>
          <span className="course-live-signals__yellow">Есть вопрос</span>
          <span className="course-live-signals__red">Не понимаю</span>
        </div>
      </div>
      <div className="course-live-card__actions">
        {canManage && (
          <button
            type="button"
            className="btn-primary course-live-card__action"
            disabled={startMutation.isPending}
            onClick={() => startMutation.mutate(firstLecture.id)}
          >
            <Play size={17} aria-hidden="true" />
            {startMutation.isPending ? "Запускаем…" : "Начать лекцию"}
          </button>
        )}
        <Link className="course-live-card__secondary" to={`/courses/${courseId}/materials`}>
          Все лекции
        </Link>
      </div>
    </section>
  );
}
