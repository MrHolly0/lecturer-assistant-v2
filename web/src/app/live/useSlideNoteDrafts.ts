import { useCallback, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

type NoteDrafts = Record<number, string>;

/** One in-memory draft for the main notes editor and every detached view. */
export function useSlideNoteDrafts(courseId: string, deckId: string) {
  const client = useQueryClient();
  const key = useMemo(() => ["slide-note-drafts", courseId, deckId], [courseId, deckId]);
  const { data: drafts } = useQuery({
    queryKey: key,
    queryFn: () => client.getQueryData<NoteDrafts>(key) ?? {},
    initialData: {} as NoteDrafts,
    enabled: false,
    staleTime: Infinity,
    gcTime: Infinity
  });
  const updateDraft = useCallback(
    (idx: number, content?: string, expected?: string) => {
      client.setQueryData<NoteDrafts>(key, (current = {}) => {
        if (content === undefined) {
          if ((expected !== undefined && current[idx] !== expected) || !(idx in current))
            return current;
          const next = { ...current };
          delete next[idx];
          return next;
        }
        return current[idx] === content ? current : { ...current, [idx]: content };
      });
    },
    [client, key]
  );
  return { drafts, updateDraft };
}
