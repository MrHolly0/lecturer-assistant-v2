import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, Play, Plus, RefreshCw } from "lucide-react";
import { listLectures } from "../app/api/content-api";
import { getCourse } from "../app/api/courses-api";
import { Button, LinkButton } from "../shared/ui/button";
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList
} from "../shared/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "../shared/ui/popover";
import { HighlightMatch } from "./ListControls";
import { StartSessionDialog } from "./StartSessionDialog";

export function CourseQuickStart({
  courseId,
  blocked,
  variant = "catalog",
  preferredLectureId
}: {
  courseId: string;
  blocked: boolean;
  variant?: "catalog" | "overview";
  preferredLectureId?: string;
}) {
  const [lectureQuery, setLectureQuery] = useState("");
  const [lectureId, setLectureId] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [startOpen, setStartOpen] = useState(false);
  const accessQuery = useQuery({
    queryKey: ["courses", courseId],
    queryFn: () => getCourse(courseId)
  });
  const canManage = accessQuery.data?.canManage === true;
  const archived = accessQuery.data?.archived === true;
  const lecturesQuery = useQuery({
    queryKey: ["content", courseId, "lectures"],
    queryFn: () => listLectures(courseId),
    enabled: canManage
  });
  const lectures = useMemo(
    () => (lecturesQuery.data ?? []).filter((lecture) => !lecture.archived),
    [lecturesQuery.data]
  );
  const selectedLecture =
    lectures.find((lecture) => lecture.id === lectureId) ??
    lectures.find((lecture) => lecture.id === preferredLectureId) ??
    lectures[0] ??
    null;
  const loading = accessQuery.isLoading || (canManage && lecturesQuery.isLoading);
  const failed = accessQuery.isError || (canManage && lecturesQuery.isError);
  const hasLectures = canManage && !archived && !loading && !failed && lectures.length > 0;
  const placeholder = loading
    ? "Загрузка лекций…"
    : failed
      ? "Лекции недоступны"
      : archived
        ? "Курс в архиве"
        : !canManage
          ? "Нет доступа к запуску"
          : "Нет готовых лекций";
  return (
    <div className={`course-quick-start course-quick-start--${variant}`}>
      <div className="course-quick-start__field">
        <span className="course-quick-start__label">
          {variant === "overview" ? "Лекция для занятия" : "Лекция"}
        </span>
        <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              className="course-quick-start__select"
              role="combobox"
              aria-expanded={pickerOpen}
              aria-label={`Лекция для занятия: ${selectedLecture?.title ?? placeholder}`}
              disabled={!hasLectures}
            >
              <span>{hasLectures ? selectedLecture?.title : placeholder}</span>
              <ChevronDown aria-hidden="true" />
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" className="lecture-picker" sideOffset={4}>
            <Command label="Выбор лекции">
              <CommandInput
                placeholder="Найти лекцию"
                aria-label="Поиск лекции"
                value={lectureQuery}
                onValueChange={setLectureQuery}
              />
              <CommandList>
                <CommandEmpty>Лекции не найдены.</CommandEmpty>
                {lectures.map((lecture) => (
                  <CommandItem
                    key={lecture.id}
                    value={`${lecture.id} ${lecture.title}`}
                    onSelect={() => {
                      setLectureId(lecture.id);
                      setPickerOpen(false);
                    }}
                  >
                    <span
                      className={`lecture-picker__radio${selectedLecture?.id === lecture.id ? " is-selected" : ""}`}
                    ></span>
                    <span>
                      <HighlightMatch text={lecture.title} query={lectureQuery} />
                    </span>
                  </CommandItem>
                ))}
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
        {selectedLecture && hasLectures && (
          <p className="course-quick-start__deck">
            <span>Презентация: </span>
            {selectedLecture.deckTitle} · версия {selectedLecture.deckVersion}
          </p>
        )}
        {failed && (
          <Button
            type="button"
            variant="ghost"
            className="course-quick-start__retry"
            onClick={() => {
              if (accessQuery.isError) void accessQuery.refetch();
              if (lecturesQuery.isError) void lecturesQuery.refetch();
            }}
          >
            <RefreshCw />
            Повторить загрузку
          </Button>
        )}
      </div>
      {canManage && !archived && !loading && !failed && lectures.length === 0 ? (
        <LinkButton className="course-quick-start__action" to={`/courses/${courseId}/materials`}>
          <Plus aria-hidden="true" />
          Добавить лекцию
        </LinkButton>
      ) : (
        <Button
          type="button"
          className="course-quick-start__action"
          disabled={blocked || !hasLectures}
          onClick={() => setStartOpen(true)}
        >
          <Play aria-hidden="true" />
          Провести занятие
        </Button>
      )}
      <p className="course-quick-start__hint" aria-live="polite">
        {archived
          ? "Восстановите курс из архива, чтобы проводить занятия."
          : blocked
            ? "Сначала завершите текущее занятие или проверьте его состояние."
            : !loading && !failed && !canManage
              ? "У вас нет прав проводить занятия в этом курсе."
              : !loading && !failed && lectures.length === 0
                ? "Добавьте лекцию в материалах курса."
                : "Далее выберите учебные группы."}
      </p>
      <StartSessionDialog
        courseId={courseId}
        lecture={selectedLecture}
        open={startOpen}
        onOpenChange={setStartOpen}
      />
    </div>
  );
}
