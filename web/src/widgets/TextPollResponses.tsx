import { useInfiniteQuery } from "@tanstack/react-query";
import { listTextPollResponses } from "../app/api/interaction-api";
import { Button } from "../shared/ui/button";

export function TextPollResponses({
  courseId,
  sessionId,
  pollId,
  live = false,
  background = false
}: {
  courseId: string;
  sessionId: string;
  pollId: string;
  live?: boolean;
  background?: boolean;
}) {
  const query = useInfiniteQuery({
    queryKey: ["poll-text", courseId, sessionId, pollId],
    queryFn: ({ pageParam }) => listTextPollResponses(courseId, sessionId, pollId, pageParam),
    initialPageParam: 0,
    getNextPageParam: (page) =>
      page.offset + page.items.length < page.total ? page.offset + page.items.length : undefined,
    refetchInterval: live ? 2000 : false,
    refetchIntervalInBackground: background
  });
  const answers = query.data?.pages.flatMap((page) => page.items) ?? [];
  return (
    <section className="text-poll-responses" aria-label="Текстовые ответы">
      <p className="muted">
        Ответы видны только преподавателю · {query.data?.pages[0]?.total ?? 0}
      </p>
      {query.isLoading && <p role="status">Загрузка ответов…</p>}
      {query.isError && (
        <div role="alert">
          <p>Не удалось загрузить текстовые ответы.</p>
          <Button type="button" variant="outline" onClick={() => query.refetch()}>
            Повторить
          </Button>
        </div>
      )}
      {!query.isLoading && !query.isError && !answers.length && (
        <p className="muted">Ответов пока нет.</p>
      )}
      <ol>
        {answers.map((answer) => (
          <li key={answer.id} className="text-poll-answer">
            {answer.text}
          </li>
        ))}
      </ol>
      {query.hasNextPage && (
        <Button
          type="button"
          variant="outline"
          disabled={query.isFetchingNextPage}
          onClick={() => query.fetchNextPage()}
        >
          {query.isFetchingNextPage ? "Загрузка…" : "Показать ещё ответы"}
        </Button>
      )}
    </section>
  );
}
