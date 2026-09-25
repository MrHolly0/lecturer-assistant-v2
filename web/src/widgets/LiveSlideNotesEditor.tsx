import { useEffect, useState } from "react";
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
  const queryKey = ["content", courseId, "decks", deckId];

  useEffect(() => setDraft(currentContent), [currentContent, slide.idx]);

  const updateCachedNote = (note?: SlideNote) => {
    queryClient.setQueryData<SlideDeckDetails>(queryKey, (current) =>
      current
        ? {
            ...current,
            slides: current.slides.map((item) =>
              item.idx === slide.idx ? { ...item, note } : item
            )
          }
        : current
    );
  };
  const saveMutation = useMutation({
    mutationFn: () => saveSlideNote(courseId, deckId, slide.idx, draft),
    onSuccess: (note) => {
      updateCachedNote(note);
      toast.success("Заметка сохранена.");
    },
    onError: (error) => toast.error(userErrorMessage(error, "Не удалось сохранить заметку."))
  });
  const clearMutation = useMutation({
    mutationFn: () => deleteSlideNote(courseId, deckId, slide.idx),
    onSuccess: () => {
      setDraft("");
      updateCachedNote(undefined);
      toast.success("Заметка очищена.");
    },
    onError: (error) => toast.error(userErrorMessage(error, "Не удалось очистить заметку."))
  });
  const pending = saveMutation.isPending || clearMutation.isPending;
  const dirty = draft !== currentContent;

  return (
    <div className="live-note-editor">
      <Textarea
        value={draft}
        rows={6}
        maxLength={20000}
        placeholder="Тезисы, напоминания и примеры для этого слайда"
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if ((event.ctrlKey || event.metaKey) && event.key === "Enter" && dirty) {
            event.preventDefault();
            saveMutation.mutate();
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
          onClick={() => (slide.note ? clearMutation.mutate() : setDraft(""))}
        >
          <Eraser size={16} aria-hidden="true" /> Очистить
        </Button>
        <Button type="button" disabled={pending || !dirty} onClick={() => saveMutation.mutate()}>
          <Save size={16} aria-hidden="true" />
          {saveMutation.isPending ? "Сохраняем…" : "Сохранить"}
        </Button>
      </div>
    </div>
  );
}
