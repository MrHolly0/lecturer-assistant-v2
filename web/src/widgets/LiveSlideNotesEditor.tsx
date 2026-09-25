import { useCallback, useEffect, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Eraser, Save } from "lucide-react";
import { toast } from "sonner";
import {
  deleteSlideNote,
  saveSlideNote,
  type Slide,
  type SlideDeckDetails,
  type SlideNote
} from "../app/api/content-api";
import { userErrorMessage } from "../app/api/errors";
import { Button } from "../shared/ui/button";
import { Textarea } from "../shared/ui/textarea";

interface Props {
  courseId: string;
  deckId: string;
  slide: Pick<Slide, "idx" | "note">;
}

export function LiveSlideNotesEditor({ courseId, deckId, slide }: Props) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState(slide.note?.content ?? "");
  const currentContent = slide.note?.content ?? "";
  const draftRef = useRef(draft);
  const activeSlideRef = useRef({ idx: slide.idx, savedContent: currentContent });
  const unsavedDraftsRef = useRef(new Map<number, string>());
  const submittedRef = useRef(new Map<number, string>());

  const updateCachedNote = useCallback(
    (slideIdx: number, note?: SlideNote) => {
      queryClient.setQueryData<SlideDeckDetails>(
        ["content", courseId, "decks", deckId],
        (current) =>
          current
            ? {
                ...current,
                slides: current.slides.map((item) =>
                  item.idx === slideIdx ? { ...item, note } : item
                )
              }
            : current
      );
    },
    [courseId, deckId, queryClient]
  );
  const saveMutation = useMutation({
    mutationFn: ({ slideIdx, content }: { slideIdx: number; content: string }) =>
      saveSlideNote(courseId, deckId, slideIdx, content),
    onSuccess: (note, variables) => {
      if (submittedRef.current.get(variables.slideIdx) !== variables.content) return;
      updateCachedNote(variables.slideIdx, note);
      if (unsavedDraftsRef.current.get(variables.slideIdx) === variables.content) {
        unsavedDraftsRef.current.delete(variables.slideIdx);
      }
      toast.success("Заметка сохранена.");
    },
    onError: (error, variables) => {
      if (submittedRef.current.get(variables.slideIdx) === variables.content) {
        submittedRef.current.delete(variables.slideIdx);
      }
      toast.error(userErrorMessage(error, "Не удалось сохранить заметку."));
    }
  });
  const clearMutation = useMutation({
    mutationFn: ({ slideIdx }: { slideIdx: number }) => deleteSlideNote(courseId, deckId, slideIdx),
    onSuccess: (_, variables) => {
      updateCachedNote(variables.slideIdx, undefined);
      unsavedDraftsRef.current.delete(variables.slideIdx);
      submittedRef.current.delete(variables.slideIdx);
      if (activeSlideRef.current.idx === variables.slideIdx) {
        draftRef.current = "";
        activeSlideRef.current.savedContent = "";
        setDraft("");
      }
      toast.success("Заметка очищена.");
    },
    onError: (error) => toast.error(userErrorMessage(error, "Не удалось очистить заметку."))
  });

  const submitNote = useCallback(
    (slideIdx: number, content: string) => {
      submittedRef.current.set(slideIdx, content);
      saveMutation.mutate({ slideIdx, content });
    },
    [saveMutation]
  );

  useEffect(() => {
    const previous = activeSlideRef.current;
    if (previous.idx !== slide.idx) {
      const previousDraft = draftRef.current;
      if (
        previousDraft !== previous.savedContent &&
        submittedRef.current.get(previous.idx) !== previousDraft
      ) {
        submitNote(previous.idx, previousDraft);
      }

      const nextDraft = unsavedDraftsRef.current.get(slide.idx) ?? currentContent;
      activeSlideRef.current = { idx: slide.idx, savedContent: currentContent };
      draftRef.current = nextDraft;
      setDraft(nextDraft);
      return;
    }

    if (previous.savedContent !== currentContent) {
      const previousSavedContent = previous.savedContent;
      activeSlideRef.current.savedContent = currentContent;
      if (unsavedDraftsRef.current.get(slide.idx) === currentContent) {
        unsavedDraftsRef.current.delete(slide.idx);
      }
      if (draftRef.current === previousSavedContent) {
        draftRef.current = currentContent;
        setDraft(currentContent);
      }
    }
  }, [currentContent, slide.idx, submitNote]);

  const pending = saveMutation.isPending || clearMutation.isPending;
  const dirty = draft !== currentContent;

  return (
    <div className="live-note-editor">
      <Textarea
        value={draft}
        rows={6}
        maxLength={20000}
        placeholder="Тезисы, напоминания и примеры для этого слайда"
        onChange={(event) => {
          const nextDraft = event.target.value;
          draftRef.current = nextDraft;
          setDraft(nextDraft);
          if (nextDraft === currentContent) {
            unsavedDraftsRef.current.delete(slide.idx);
          } else {
            unsavedDraftsRef.current.set(slide.idx, nextDraft);
          }
        }}
        onKeyDown={(event) => {
          if ((event.ctrlKey || event.metaKey) && event.key === "Enter" && dirty) {
            event.preventDefault();
            submitNote(slide.idx, draft);
          }
        }}
      />
      <div className="live-note-editor__meta">
        <span>{draft.length.toLocaleString("ru-RU")} / 20 000</span>
        {slide.note && (
          <span>
            Сохранено{" "}
            {new Date(slide.note.updatedAt).toLocaleTimeString("ru-RU", {
              hour: "2-digit",
              minute: "2-digit"
            })}
          </span>
        )}
      </div>
      <div className="live-note-editor__actions">
        <Button
          type="button"
          variant="outline"
          disabled={pending || (!slide.note && !draft)}
          onClick={() => {
            if (slide.note) {
              clearMutation.mutate({ slideIdx: slide.idx });
              return;
            }
            draftRef.current = "";
            unsavedDraftsRef.current.delete(slide.idx);
            setDraft("");
          }}
        >
          <Eraser size={16} aria-hidden="true" /> Очистить
        </Button>
        <Button
          type="button"
          disabled={pending || !dirty}
          onClick={() => submitNote(slide.idx, draft)}
        >
          <Save size={16} aria-hidden="true" />
          {saveMutation.isPending ? "Сохраняем…" : "Сохранить"}
        </Button>
      </div>
    </div>
  );
}
