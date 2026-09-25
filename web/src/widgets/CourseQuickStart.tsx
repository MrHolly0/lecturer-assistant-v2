import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Play } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { listLectures } from "../app/api/content-api";
import { getCourse } from "../app/api/courses-api";
import { userErrorMessage } from "../app/api/errors";
import { startLiveSession } from "../app/api/live-api";
import { Button } from "../shared/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../shared/ui/select";

export function CourseQuickStart({ courseId, blocked }: { courseId: string; blocked: boolean }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const rootRef = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [lectureId, setLectureId] = useState("");
  const accessQuery = useQuery({
    queryKey: ["courses", courseId],
    queryFn: () => getCourse(courseId),
    enabled: visible
  });
  const lecturesQuery = useQuery({
    queryKey: ["content", courseId, "lectures"],
    queryFn: () => listLectures(courseId),
    enabled: visible && accessQuery.data?.canManage === true
  });
  const lectures = useMemo(
    () => (lecturesQuery.data ?? []).filter((lecture) => !lecture.archived),
    [lecturesQuery.data]
  );

  useEffect(() => {
    const node = rootRef.current;
    if (!node || typeof IntersectionObserver === "undefined") {
      setVisible(true);
      return;
    }
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: "160px" }
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!lectures.some((lecture) => lecture.id === lectureId)) {
      setLectureId(lectures[0]?.id ?? "");
    }
  }, [lectureId, lectures]);

  const startMutation = useMutation({
    mutationFn: () => startLiveSession(courseId, lectureId),
    onSuccess: (session) => {
      void queryClient.invalidateQueries({ queryKey: ["active-session"] });
      navigate(`/courses/${courseId}/sessions/${session.id}/presenter`);
    },
    onError: (error) => toast.error(userErrorMessage(error, "Не удалось запустить лекцию."))
  });

  if (visible && (accessQuery.isError || accessQuery.data?.canManage === false)) return null;

  return (
    <div ref={rootRef} className="course-quick-start">
      {(!visible || accessQuery.isLoading || lecturesQuery.isLoading) && (
        <span className="course-quick-start__state">Загрузка лекций…</span>
      )}
      {lecturesQuery.isError && (
        <span className="course-quick-start__state">Лекции недоступны</span>
      )}
      {visible && !lecturesQuery.isLoading && !lecturesQuery.isError && lectures.length === 0 && (
        <span className="course-quick-start__state">Нет готовых лекций</span>
      )}
      {lectures.length === 1 && (
        <span className="course-quick-start__title" title={lectures[0].title}>
          {lectures[0].title}
        </span>
      )}
      {lectures.length > 1 && (
        <Select value={lectureId} onValueChange={setLectureId}>
          <SelectTrigger aria-label="Лекция для запуска" className="course-quick-start__select">
            <SelectValue placeholder="Выберите лекцию" />
          </SelectTrigger>
          <SelectContent align="end">
            {lectures.map((lecture) => (
              <SelectItem key={lecture.id} value={lecture.id}>
                {lecture.title}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
      {lectures.length > 0 && (
        <Button
          type="button"
          disabled={blocked || !lectureId || startMutation.isPending}
          title={blocked ? "Сначала завершите текущую лекцию" : "Запустить лекцию"}
          onClick={() => startMutation.mutate()}
        >
          <Play size={15} aria-hidden="true" />
          Запустить
        </Button>
      )}
    </div>
  );
}
