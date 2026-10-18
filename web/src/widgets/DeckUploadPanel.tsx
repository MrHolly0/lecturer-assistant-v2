import { useId, useRef } from "react";
import { FileText, Upload } from "lucide-react";
import { Button } from "../shared/ui/button";

interface DeckUploadPanelProps {
  title: string;
  fileName: string;
  dragOver: boolean;
  progress: number;
  importing: boolean;
  error: string | null;
  phase?: string;
  processedSlides?: number;
  totalSlides?: number;
  warning?: string | null;
  onTitleChange: (value: string) => void;
  onFile: (file: File) => void;
  onDragOverChange: (value: boolean) => void;
}

export function DeckUploadPanel({
  title,
  fileName,
  dragOver,
  progress,
  importing,
  error,
  phase,
  processedSlides,
  totalSlides,
  warning,
  onTitleChange,
  onFile,
  onDragOverChange
}: DeckUploadPanelProps) {
  const fileInput = useRef<HTMLInputElement>(null);
  const inputId = useId();
  const displayError =
    error && /^Загрузка завершилась с ошибкой \d+$/.test(error)
      ? "Не удалось загрузить презентацию. Проверьте файл и выберите его снова."
      : error;
  return (
    <section className="material-section preparation-upload">
      <div className="mb-6 max-w-xl">
        <label className="field">
          <span>Название презентации</span>
          <input
            type="text"
            value={title}
            onChange={(event) => onTitleChange(event.target.value)}
            placeholder="Можно оставить пустым, возьмём из имени файла"
          />
        </label>
      </div>

      {error && fileName && (
        <div className="preparation-upload__file">
          <FileText size={24} aria-hidden="true" />
          <strong>{fileName}</strong>
        </div>
      )}
      {!importing && (
        <div
          className={`upload-dropzone ${dragOver ? "upload-dropzone--active" : ""}`}
          onDragOver={(event) => {
            event.preventDefault();
            onDragOverChange(true);
          }}
          onDragLeave={() => onDragOverChange(false)}
          onDrop={(event) => {
            event.preventDefault();
            onDragOverChange(false);
            const file = event.dataTransfer.files?.[0];
            if (file) onFile(file);
          }}
        >
          <input
            ref={fileInput}
            id={inputId}
            aria-label="Файл презентации"
            type="file"
            accept=".ppt,.pptx,.odp,.pdf"
            hidden
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) onFile(file);
              event.target.value = "";
            }}
          />
          <span className="upload-icon">
            <Upload size={32} />
          </span>
          <strong>Перетащите файл сюда</strong>
          <span className="muted">PowerPoint, ODP или PDF до 100 МБ</span>
          <Button type="button" onClick={() => fileInput.current?.click()}>
            {error ? "Выбрать другой файл" : "Выбрать файл"}
          </Button>
        </div>
      )}

      {importing && (
        <div className="upload-progress">
          <FileText size={20} />
          <div className="upload-progress__body">
            <div className="upload-progress__meta">
              <span>{fileName}</span>
              <span>{progress}%</span>
            </div>
            <div className="progress-track">
              <div className="progress-fill" style={{ width: `${progress}%` }} />
            </div>
            <span className="muted">{progressLabel(phase, processedSlides, totalSlides)}</span>
          </div>
        </div>
      )}

      {warning && <p className="form-warning">{warning}</p>}
      {error && (
        <p className="form-error" role="alert">
          {displayError}
        </p>
      )}
    </section>
  );
}

function progressLabel(phase?: string, processedSlides?: number, totalSlides?: number): string {
  if (totalSlides && totalSlides > 0) {
    return `Разбор слайдов: слайд ${processedSlides ?? 0} из ${totalSlides}`;
  }
  return phase || "Загрузка и разбор слайдов...";
}
