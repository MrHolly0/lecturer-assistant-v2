import { useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Archive, ChevronRight, MoreHorizontal, RotateCcw, Trash2 } from "lucide-react";
import type { components } from "../app/api/schema";
import { getCourse } from "../app/api/courses-api";
import { includesQuery } from "../shared/lib/usePagedList";
import { pluralizeRu } from "../shared/lib/plural";
import { IconButton } from "../shared/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from "../shared/ui/dropdown-menu";
import { HighlightMatch } from "./ListControls";

export type CourseCatalogAction = { id: string; title: string; kind: "archive" | "delete" };

interface CourseCatalogItemProps {
  course: components["schemas"]["Course"];
  lectures: components["schemas"]["Lecture"][];
  query: string;
  active: boolean;
  loading: boolean;
  error: boolean;
  archiving: boolean;
  restoring: boolean;
  deleting: boolean;
  onSelect: () => void;
  onAction: (action: CourseCatalogAction, trigger: HTMLButtonElement | null) => void;
  onRestore: (courseId: string) => void;
}

export function CourseCatalogItem({
  course,
  lectures,
  query,
  active,
  loading,
  error,
  archiving,
  restoring,
  deleting,
  onSelect,
  onAction,
  onRestore
}: CourseCatalogItemProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuTrigger = useRef<HTMLButtonElement>(null);
  const access = useQuery({
    queryKey: ["courses", course.id],
    queryFn: () => getCourse(course.id),
    enabled: menuOpen
  });
  const canManage = access.data?.canManage === true && !access.isError && !access.isFetching;
  const matches = query ? lectures.filter((lecture) => includesQuery(query, lecture.title)) : [];
  return (
    <li className={`catalog-course${active ? " is-selected" : ""}`}>
      <button
        type="button"
        className="catalog-course__select"
        aria-current={active ? "true" : undefined}
        onClick={onSelect}
      >
        <strong>{course.title}</strong>
        <span className="catalog-course__meta-desktop">
          {loading ? (
            "Загрузка лекций…"
          ) : error ? (
            "Лекции недоступны"
          ) : matches.length > 0 ? (
            <>
              Совпадение в лекции
              <br />
              <HighlightMatch text={matches[0].title} query={query} />
            </>
          ) : lectures.length > 0 ? (
            lectures[0].title
          ) : (
            "Нет готовых лекций"
          )}
        </span>
        <span className="catalog-course__meta-mobile">
          {loading
            ? "Загрузка лекций…"
            : error
              ? "Лекции недоступны"
              : matches.length > 0
                ? matches[0].title
                : lectures.length === 0
                  ? "Пока нет лекций"
                  : `${lectures.length} ${pluralizeRu(lectures.length, "лекция", "лекции", "лекций")}`}
        </span>
      </button>
      <div className="catalog-course__actions">
        <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
          <DropdownMenuTrigger asChild>
            <IconButton ref={menuTrigger} label={`Действия курса: ${course.title}`} tooltip={false}>
              <MoreHorizontal />
            </IconButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {access.isFetching || (!access.data && access.isPending) ? (
              <div role="status" className="px-3 py-2 text-sm text-muted-foreground">
                Проверяем права курса…
              </div>
            ) : access.isError ? (
              <DropdownMenuItem
                onSelect={(event) => {
                  event.preventDefault();
                  void access.refetch();
                }}
              >
                Не удалось проверить права. Повторить
              </DropdownMenuItem>
            ) : !canManage ? (
              <div role="status" className="px-3 py-2 text-sm text-muted-foreground">
                У вас нет прав управлять этим курсом.
              </div>
            ) : course.archived ? (
              <>
                <DropdownMenuItem disabled={restoring} onSelect={() => onRestore(course.id)}>
                  <RotateCcw />
                  Восстановить
                </DropdownMenuItem>
                <DropdownMenuItem
                  variant="destructive"
                  disabled={deleting}
                  onSelect={() =>
                    window.setTimeout(
                      () =>
                        onAction(
                          { id: course.id, title: course.title, kind: "delete" },
                          menuTrigger.current
                        ),
                      0
                    )
                  }
                >
                  <Trash2 />
                  Удалить навсегда
                </DropdownMenuItem>
              </>
            ) : (
              <DropdownMenuItem
                disabled={archiving}
                onSelect={() =>
                  window.setTimeout(
                    () =>
                      onAction(
                        { id: course.id, title: course.title, kind: "archive" },
                        menuTrigger.current
                      ),
                    0
                  )
                }
              >
                <Archive />
                Архивировать
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
        <Link
          className="catalog-course__mobile-open"
          to={`/courses/${course.id}`}
          aria-label={`Открыть курс: ${course.title}`}
        >
          <ChevronRight />
        </Link>
      </div>
    </li>
  );
}
