import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import {
  createLecture,
  getDeck,
  getImportJob,
  listDecks,
  listLectures,
  saveSlideNote,
  uploadDeck,
  type ImportJob
} from "../app/api/content-api";
import { DeckUploadPanel } from "../widgets/DeckUploadPanel";
import { DeckViewer } from "../widgets/DeckViewer";
import { LectureList } from "../widgets/LectureList";

export function MaterialsPage({ courseId }: { courseId: string }) {
  const qc = useQueryClient();
  const [title, setTitle] = useState("");
  const [fileName, setFileName] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [job, setJob] = useState<ImportJob | null>(null);
  const [selectedDeckId, setSelectedDeckId] = useState("");
  const [activeSlide, setActiveSlide] = useState(0);
  const [notesOpen, setNotesOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lectureTitle, setLectureTitle] = useState("");
  const [lectureDeckId, setLectureDeckId] = useState("");

  const decksQuery = useQuery({
    queryKey: ["content", courseId, "decks"],
    queryFn: () => listDecks(courseId)
  });
  const lecturesQuery = useQuery({
    queryKey: ["content", courseId, "lectures"],
    queryFn: () => listLectures(courseId)
  });
  const jobQuery = useQuery({
    queryKey: ["content", courseId, "jobs", job?.id],
    queryFn: () => getImportJob(courseId, job?.id ?? ""),
    enabled: Boolean(job && job.status !== "COMPLETED" && job.status !== "FAILED"),
    refetchInterval: 1000
  });
  const deckQuery = useQuery({
    queryKey: ["content", courseId, "decks", selectedDeckId],
    queryFn: () => getDeck(courseId, selectedDeckId),
    enabled: Boolean(selectedDeckId)
  });

  const decks = useMemo(() => decksQuery.data ?? [], [decksQuery.data]);
  const lectures = useMemo(() => lecturesQuery.data ?? [], [lecturesQuery.data]);
  const selectedDeck = deckQuery.data;
  const latestJob = jobQuery.data ?? job;

  useEffect(() => {
    if (!jobQuery.data) return;
    setJob(jobQuery.data);
    setUploadProgress(Math.max(75, jobQuery.data.progressPercent));
    if (jobQuery.data.status === "COMPLETED" && jobQuery.data.deckId) {
      setSelectedDeckId(jobQuery.data.deckId);
      setLectureDeckId(jobQuery.data.deckId);
      setJob(null);
      setUploadProgress(100);
      void qc.invalidateQueries({ queryKey: ["content", courseId, "decks"] });
    }
    if (jobQuery.data.status === "FAILED") {
      setError(jobQuery.data.errorMessage ?? "Импорт завершился ошибкой");
      setJob(null);
    }
  }, [courseId, jobQuery.data, qc]);

  useEffect(() => {
    if (!selectedDeckId && decks[0]) {
      setSelectedDeckId(decks[0].id);
      setLectureDeckId(decks[0].id);
    }
  }, [decks, selectedDeckId]);

  useEffect(() => {
    setActiveSlide(0);
    setNotesOpen(false);
  }, [selectedDeckId]);

  const importing = Boolean(
    latestJob && latestJob.status !== "COMPLETED" && latestJob.status !== "FAILED"
  );
  const displayedProgress = importing
    ? latestJob?.progressPercent ?? uploadProgress
    : uploadProgress;
  const selectedDeckTitle = useMemo(
    () => decks.find((deck) => deck.id === selectedDeckId)?.title ?? "Материалы курса",
    [decks, selectedDeckId]
  );

  const createLectureMut = useMutation({
    mutationFn: () => createLecture(courseId, lectureTitle.trim(), lectureDeckId),
    onSuccess: () => {
      setLectureTitle("");
      void qc.invalidateQueries({ queryKey: ["content", courseId, "lectures"] });
    }
  });

  const saveNoteMut = useMutation({
    mutationFn: (content: string) =>
      saveSlideNote(courseId, selectedDeckId, selectedDeck?.slides[activeSlide]?.idx ?? 1, content),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["content", courseId, "decks", selectedDeckId] });
    }
  });

  async function handleFile(file: File) {
    setError(null);
    if (!title.trim()) {
      setError("Сначала введите название лекции");
      return;
    }
    setFileName(file.name);
    setUploadProgress(1);
    try {
      const nextJob = await uploadDeck(courseId, title.trim(), file, setUploadProgress);
      setJob(nextJob);
      setUploadProgress(Math.max(75, nextJob.progressPercent));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось загрузить файл");
      setUploadProgress(0);
    }
  }

  return (
    <div className="page page--wide">
      <div className="page-header">
        <Link to={`/courses/${courseId}`} className="breadcrumb">
          ← Курс
        </Link>
        <h1>Материалы курса</h1>
        <span className="muted">{selectedDeckTitle}</span>
      </div>

      <DeckUploadPanel
        title={title}
        fileName={fileName}
        dragOver={dragOver}
        progress={displayedProgress}
        importing={importing}
        error={error}
        onTitleChange={setTitle}
        onFile={(file) => void handleFile(file)}
        onDragOverChange={setDragOver}
      />

      <section className="material-section">
        <div className="section-heading">
          <h2>Презентации</h2>
          <span className="muted">{decks.length} версий</span>
        </div>
        <div className="deck-list">
          {decks.length === 0 && <p className="muted">Загрузите первую презентацию курса.</p>}
          {decks.map((deck) => (
            <button
              key={deck.id}
              type="button"
              className={`deck-pill ${deck.id === selectedDeckId ? "deck-pill--active" : ""}`}
              onClick={() => {
                setSelectedDeckId(deck.id);
                setLectureDeckId(deck.id);
              }}
            >
              <span>{deck.title}</span>
              <small>
                v{deck.version} · {deck.slideCount} слайдов
              </small>
            </button>
          ))}
        </div>
      </section>

      {selectedDeck && (
        <DeckViewer
          courseId={courseId}
          deck={selectedDeck}
          activeIndex={activeSlide}
          notesOpen={notesOpen}
          savingNote={saveNoteMut.isPending}
          onSlideChange={setActiveSlide}
          onNotesOpenChange={setNotesOpen}
          onSaveNote={(content) => saveNoteMut.mutateAsync(content).then(() => undefined)}
        />
      )}

      <LectureList
        lectures={lectures}
        decks={decks}
        title={lectureTitle}
        deckId={lectureDeckId}
        creating={createLectureMut.isPending}
        onTitleChange={setLectureTitle}
        onDeckChange={setLectureDeckId}
        onCreate={() => createLectureMut.mutate()}
      />
    </div>
  );
}
