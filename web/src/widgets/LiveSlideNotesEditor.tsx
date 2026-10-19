import { useCallback, useEffect, useRef, useState } from "react";
import { useIsMutating, useMutation, useQueryClient } from "@tanstack/react-query";
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
  draft?: string;
  onDraftChange?: (slideIdx: number, content?: string, expectedContent?: string) => void;
}

export function LiveSlideNotesEditor({
  courseId,
  deckId,
  slide,
  draft: controlledDraft,
  onDraftChange
}: Props) {
  const queryClient = useQueryClient();
  const [localDraft, setLocalDraft] = useState(slide.note?.content ?? "");
  const currentContent = slide.note?.content ?? "";
  const draft = onDraftChange ? controlledDraft ?? currentContent : controlledDraft ?? localDraft;
  const draftRef = useRef(draft);
  const activeSlideRef = useRef({ idx: slide.idx, savedContent: currentContent });
  const unsavedDraftsRef = useRef(new Map<number, string>());
  const submittedRef = useRef(new Map<number, string>());
  const setCurrentDraft = useCallback(
    (content: string, slideIdx = activeSlideRef.current.idx) => {
      draftRef.current = content;
      setLocalDraft(content);
      onDraftChange?.(slideIdx, content);
      if (content === currentContent) unsavedDraftsRef.current.delete(slideIdx);
      else unsavedDraftsRef.current.set(slideIdx, content);
    },
    [currentContent, onDraftChange]
  );

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
    mutationKey: ["slide-note", courseId, deckId, "save"],
    mutationFn: ({ slideIdx, content }: { slideIdx: number; content: string }) =>
      saveSlideNote(courseId, deckId, slideIdx, content),
    onSuccess: (note, variables) => {
      if (submittedRef.current.get(variables.slideIdx) !== variables.content) return;
      updateCachedNote(variables.slideIdx, note);
      onDraftChange?.(variables.slideIdx, undefined, variables.content);
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
    mutationKey: ["slide-note", courseId, deckId, "clear"],
    mutationFn: ({ slideIdx }: { slideIdx: number }) => deleteSlideNote(courseId, deckId, slideIdx),
    onSuccess: (_, variables) => {
      updateCachedNote(variables.slideIdx, undefined);
      onDraftChange?.(variables.slideIdx, undefined);
      unsavedDraftsRef.current.delete(variables.slideIdx);
      submittedRef.current.delete(variables.slideIdx);
      if (activeSlideRef.current.idx === variables.slideIdx) {
        activeSlideRef.current.savedContent = "";
        setCurrentDraft("", variables.slideIdx);
      }
      toast.success("Заметка очищена.");
    },
    onError: (error) => toast.error(userErrorMessage(error, "Не удалось очистить заметку."))
  });

  const submitNote = useCallback(
    (slideIdx: number, content: string) => {
      const alreadySaving = queryClient
        .getMutationCache()
        .findAll({
          mutationKey: ["slide-note", courseId, deckId, "save"],
          status: "pending"
        })
        .some((mutation) => {
          const pending = mutation.state.variables as
            | { slideIdx: number; content: string }
            | undefined;
          return pending?.slideIdx === slideIdx && pending.content === content;
        });
      if (alreadySaving) return;
      submittedRef.current.set(slideIdx, content);
      saveMutation.mutate({ slideIdx, content });
    },
    [saveMutation, courseId, deckId, queryClient]
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

      const nextDraft = onDraftChange
        ? controlledDraft ?? currentContent
        : controlledDraft ?? unsavedDraftsRef.current.get(slide.idx) ?? currentContent;
      activeSlideRef.current = { idx: slide.idx, savedContent: currentContent };
      setCurrentDraft(nextDraft, slide.idx);
      return;
    }

    if (previous.savedContent !== currentContent) {
      const previousSavedContent = previous.savedContent;
      activeSlideRef.current.savedContent = currentContent;
      if (unsavedDraftsRef.current.get(slide.idx) === currentContent) {
        unsavedDraftsRef.current.delete(slide.idx);
      }
      if (draftRef.current === previousSavedContent) {
        setCurrentDraft(currentContent, slide.idx);
      }
    }
  }, [controlledDraft, currentContent, slide.idx, submitNote, setCurrentDraft, onDraftChange]);

  useEffect(() => {
    if (controlledDraft === undefined && !onDraftChange) return;
    const authoritative = controlledDraft ?? currentContent;
    draftRef.current = authoritative;
    setLocalDraft(authoritative);
  }, [controlledDraft, currentContent, onDraftChange]);

  const pending = useIsMutating({ mutationKey: ["slide-note", courseId, deckId] }) > 0;
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
          setCurrentDraft(nextDraft, slide.idx);
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
            setCurrentDraft("", slide.idx);
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
