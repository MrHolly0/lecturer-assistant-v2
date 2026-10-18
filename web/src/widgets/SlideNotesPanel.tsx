import { useEffect, useState } from "react";
import { Info, LockKeyhole } from "lucide-react";
import type { SlideNote } from "../app/api/content-api";
import { Button, IconButton } from "../shared/ui/button";
import { X } from "lucide-react";

interface SlideNotesPanelProps {
  slideIndex: number;
  note?: SlideNote;
  saving: boolean;
  readOnly?: boolean;
  onClose: () => void;
  onSave: (content: string) => Promise<void>;
  onClear: () => void;
}

export function SlideNotesPanel({
  slideIndex,
  note,
  saving,
  readOnly = false,
  onClose,
  onSave,
  onClear
}: SlideNotesPanelProps) {
  const [draft, setDraft] = useState(note?.content ?? "");
  const [error, setError] = useState(false);
  useEffect(() => {
    setDraft(note?.content ?? "");
    setError(false);
  }, [note?.content, slideIndex]);
  const isDirty = draft !== (note?.content ?? "");
  async function save() {
    setError(false);
    try {
      await onSave(draft);
    } catch {
      setError(true);
    }
  }
  return (
    <section
      id="slide-notes-panel"
      className="slide-notes-panel preparation-notes"
      aria-label={`Заметки к слайду ${slideIndex}`}
    >
      <div className="preparation-notes__heading">
        <h2>Заметки к слайду {slideIndex}</h2>
        <IconButton label="Закрыть заметки" onClick={onClose}>
          <X size={18} />
        </IconButton>
      </div>
      <p className="preparation-notes__privacy">
        <LockKeyhole size={17} aria-hidden="true" /> Только преподавателю
      </p>
      <label className="preparation-notes__field" htmlFor="slide-note-textarea">
        <span>Текст заметки</span>
        <textarea
          id="slide-note-textarea"
          className="snp-textarea"
          placeholder="Ваши заметки к этому слайду…"
          readOnly={readOnly}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
              event.preventDefault();
              if (isDirty && !saving && !readOnly) void save();
            }
          }}
          rows={8}
        />
      </label>
      <p className="preparation-notes__status" role="status">
        {readOnly
          ? "Доступ только к просмотру."
          : saving
            ? "Сохраняем заметку…"
            : isDirty
              ? "Есть несохранённые изменения."
              : note
                ? "Все изменения сохранены."
                : "Заметка ещё не добавлена."}
      </p>
      {error && (
        <p className="form-error" role="alert">
          Не удалось сохранить заметку. Текст сохранён в редакторе, попробуйте ещё раз.
        </p>
      )}
      {!readOnly && (
        <div className="preparation-notes__actions">
          <Button
            variant="outline"
            disabled={saving || (!note && !draft)}
            onClick={() => {
              if (note) onClear();
              else setDraft("");
            }}
          >
            Очистить
          </Button>
          <Button
            id="slide-notes-save-btn"
            disabled={!isDirty || saving}
            onClick={() => void save()}
          >
            Сохранить
          </Button>
        </div>
      )}
      <p className="preparation-notes__privacy">
        <Info size={18} aria-hidden="true" /> Заметки не видны студентам и на проекторе.
      </p>
    </section>
  );
}
