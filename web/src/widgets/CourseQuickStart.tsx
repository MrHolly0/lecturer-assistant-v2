import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Play, RefreshCw } from "lucide-react";
import { listLectures } from "../app/api/content-api";
import { getCourse } from "../app/api/courses-api";
import { Button } from "../shared/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../shared/ui/select";
import { StartSessionDialog } from "./StartSessionDialog";

export function CourseQuickStart({ courseId, blocked }: { courseId: string; blocked: boolean }) {
  const triggerRef = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [lectureId, setLectureId] = useState("");
  const [startOpen, setStartOpen] = useState(false);
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
  const effectiveLectureId = lectures.some((lecture) => lecture.id === lectureId)
    ? lectureId
    : lectures[0]?.id ?? "";
  const selectedLecture = lectures.find((lecture) => lecture.id === effectiveLectureId) ?? null;
  const accessReady = visible && !accessQuery.isLoading && !accessQuery.isError;
  const canManage = accessQuery.data?.canManage === true;
  const loading = !visible || accessQuery.isLoading || (canManage && lecturesQuery.isLoading);
  const failed = accessQuery.isError || (canManage && lecturesQuery.isError);
  const unavailable = accessReady && !canManage;
  const hasLectures = canManage && !loading && !failed && lectures.length > 0;
  const placeholder = loading
    ? "Загрузка лекций…"
    : failed
      ? "Лекции недоступны"
      : unavailable
        ? "Нет доступа к запуску"
        : lectures.length === 0
          ? "Нет готовых лекций"
          : "Выберите лекцию";

  useEffect(() => {
    const node = triggerRef.current;
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

  return (
    <div className="course-quick-start">
      <div className="course-quick-start__field">
        <span className="course-quick-start__label">Лекция</span>
        <div ref={triggerRef} className="course-quick-start__select-cell">
          <Select
            value={hasLectures ? effectiveLectureId : undefined}
            onValueChange={setLectureId}
            disabled={!hasLectures}
          >
            <SelectTrigger
              aria-label={`Лекция для занятия: ${selectedLecture?.title ?? placeholder}`}
              title={selectedLecture?.title}
              className="course-quick-start__select"
            >
              <SelectValue placeholder={placeholder} />
            </SelectTrigger>
            <SelectContent align="end">
              {lectures.map((lecture) => (
                <SelectItem key={lecture.id} value={lecture.id}>
                  {lecture.title}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <span className="course-quick-start__hint" aria-live="polite">
          {failed ? (
            <Button
              type="button"
              variant="ghost"
              className="course-quick-start__retry"
              onClick={() => {
                if (accessQuery.isError) void accessQuery.refetch();
                if (lecturesQuery.isError) void lecturesQuery.refetch();
              }}
            >
              <RefreshCw size={14} aria-hidden="true" /> Повторить загрузку
            </Button>
          ) : blocked ? (
            "Сначала завершите текущее занятие."
          ) : unavailable ? (
            "У вас нет прав проводить занятия в этом курсе."
          ) : !loading && lectures.length === 0 ? (
            "Добавьте лекцию в материалах курса."
          ) : (
            <span aria-hidden="true">&nbsp;</span>
          )}
        </span>
      </div>
      <Button
        type="button"
        className="course-quick-start__action"
        disabled={blocked || !hasLectures || !effectiveLectureId}
        title={blocked ? "Сначала завершите текущее занятие" : "Провести занятие"}
        onClick={() => setStartOpen(true)}
      >
        <Play size={15} aria-hidden="true" />
        Провести занятие
      </Button>
      <StartSessionDialog
        courseId={courseId}
        lecture={selectedLecture}
        open={startOpen}
        onOpenChange={setStartOpen}
      />
    </div>
  );
}
