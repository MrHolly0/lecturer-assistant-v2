import { useId, useState } from "react";
import { BookOpen, ChevronDown } from "lucide-react";
import type { Lecture } from "../app/api/content-api";
import { Button } from "../shared/ui/button";
import { Checkbox } from "../shared/ui/checkbox";
import { Input } from "../shared/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "../shared/ui/popover";

export function LectureMultiSelect({
  lectures,
  value,
  onChange,
  disabled,
  loading,
  error,
  onRetry
}: {
  lectures: Lecture[];
  value: string[];
  onChange: (ids: string[]) => void;
  disabled?: boolean;
  loading: boolean;
  error: boolean;
  onRetry: () => void;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const firstSelected = lectures.find((lecture) => lecture.id === value[0]);
  const summary =
    value.length === 0 ? "Без привязки" : firstSelected?.title ?? `Выбрано лекций: ${value.length}`;
  const visible = lectures.filter((lecture) =>
    lecture.title.toLocaleLowerCase("ru").includes(query.trim().toLocaleLowerCase("ru"))
  );
  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setQuery("");
      }}
    >
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          disabled={disabled}
          className="lecture-multiselect__trigger"
          aria-label={`Выбрать лекции, выбрано: ${value.length}`}
        >
          <BookOpen size={18} aria-hidden="true" />
          <span className="lecture-multiselect__summary" title={summary}>
            {summary}
          </span>
          {value.length > 1 && (
            <span className="lecture-multiselect__count">+{value.length - 1}</span>
          )}
          <ChevronDown size={18} aria-hidden="true" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        sideOffset={6}
        className="lecture-multiselect"
        aria-labelledby={`${id}-title`}
        onEscapeKeyDown={(event) => event.stopPropagation()}
      >
        <div className="lecture-multiselect__header">
          <h3 id={`${id}-title`}>Лекции для вопроса</h3>
          <Input
            autoFocus
            aria-label="Найти лекцию для привязки"
            placeholder="Найти лекцию"
            disabled={disabled}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        <div className="lecture-multiselect__list">
          {loading && (
            <p className="muted" role="status">
              Загрузка лекций…
            </p>
          )}
          {error && (
            <div role="alert">
              <p>Не удалось загрузить лекции.</p>
              <Button type="button" variant="outline" disabled={disabled} onClick={onRetry}>
                Повторить
              </Button>
            </div>
          )}
          {!loading &&
            !error &&
            visible.map((lecture) => (
              <label key={lecture.id}>
                <Checkbox
                  disabled={disabled}
                  checked={value.includes(lecture.id)}
                  onCheckedChange={(checked) =>
                    onChange(
                      checked
                        ? [...value, lecture.id]
                        : value.filter((lectureId) => lectureId !== lecture.id)
                    )
                  }
                />
                <span>
                  {lecture.title}
                  {lecture.archived ? " (в архиве)" : ""}
                </span>
              </label>
            ))}
          {!loading && !error && visible.length === 0 && (
            <p className="muted">
              {query
                ? "Лекций по запросу нет."
                : "В курсе пока нет лекций. Вопрос можно привязать позже."}
            </p>
          )}
        </div>
        <div className="lecture-multiselect__footer">
          <span className="muted" aria-live="polite">
            Выбрано: {value.length}
          </span>
          <Button
            type="button"
            variant="ghost"
            disabled={disabled || value.length === 0}
            onClick={() => onChange([])}
          >
            Снять выбор
          </Button>
          <Button
            type="button"
            disabled={disabled}
            onClick={() => {
              setOpen(false);
              setQuery("");
            }}
          >
            Готово
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
