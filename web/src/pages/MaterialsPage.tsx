import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { userErrorMessage } from "../app/api/errors";
import {
  createLecture,
  archiveDeck,
  hardDeleteDeck,
  hardDeleteLecture,
  deleteLecture,
  deleteSlideNote,
  getDeck,
  getImportJob,
  listDecks,
  listLectures,
  restoreDeck,
  restoreLecture,
  saveSlideNote,
  uploadDeck,
  type ImportJob
} from "../app/api/content-api";
import { getCourse } from "../app/api/courses-api";
import { DeckUploadPanel } from "../widgets/DeckUploadPanel";
import { DeckViewer } from "../widgets/DeckViewer";
import { LectureList } from "../widgets/LectureList";
import { startLiveSession } from "../app/api/live-api";
import { DeckListPanel } from "../widgets/DeckListPanel";
import { titleFromFileName } from "../shared/lib/fileName";

export function MaterialsPage({ courseId }: { courseId: string }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
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
  const [startingLectureId, setStartingLectureId] = useState("");
  const courseQuery = useQuery({
    queryKey: ["courses", courseId],
    queryFn: () => getCourse(courseId)
  });
  const canManage = courseQuery.data?.canManage ?? false;
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
    enabled: Boolean(
      job && job.status !== "COMPLETED" && job.status !== "PARTIAL" && job.status !== "FAILED"
    ),
    refetchInterval: 1000,
    refetchIntervalInBackground: true,
    refetchOnWindowFocus: "always"
  });
  const deckQuery = useQuery({
    queryKey: ["content", courseId, "decks", selectedDeckId],
    queryFn: () => getDeck(courseId, selectedDeckId),
    enabled: Boolean(selectedDeckId)
  });
  const decks = useMemo(() => decksQuery.data ?? [], [decksQuery.data]);
  const activeDecks = useMemo(() => decks.filter((deck) => !deck.archived), [decks]);
  const lectures = useMemo(() => lecturesQuery.data ?? [], [lecturesQuery.data]);
  const selectedDeck = deckQuery.data;
  const latestJob = jobQuery.data ?? job;
  useEffect(() => {
    setTitle("");
    setFileName("");
    setUploadProgress(0);
    setJob(null);
    setSelectedDeckId("");
    setLectureDeckId("");
    setActiveSlide(0);
    setNotesOpen(false);
    setError(null);
    setLectureTitle("");
    setStartingLectureId("");
  }, [courseId]);
  useEffect(() => {
    if (!jobQuery.data) return;
    setJob(jobQuery.data);
    setUploadProgress(jobQuery.data.progressPercent);
    if (
      (jobQuery.data.status === "COMPLETED" || jobQuery.data.status === "PARTIAL") &&
      jobQuery.data.deckId
    ) {
      setSelectedDeckId(jobQuery.data.deckId);
      setLectureDeckId(jobQuery.data.deckId);
      setJob(null);
      setUploadProgress(jobQuery.data.progressPercent);
      if (jobQuery.data.status === "PARTIAL") {
        toast.warning(
          jobQuery.data.warningMessage || jobQuery.data.errorMessage || "Импорт завершён частично"
        );
      }
      void qc.invalidateQueries({ queryKey: ["content", courseId, "decks"] });
    }
    if (jobQuery.data.status === "FAILED") {
      setError(jobQuery.data.errorMessage ?? "Импорт завершился ошибкой");
      setJob(null);
    }
  }, [courseId, jobQuery.data, qc]);
  useEffect(() => {
    if (!selectedDeckId && activeDecks[0]) {
      setSelectedDeckId(activeDecks[0].id);
      setLectureDeckId(activeDecks[0].id);
    }
  }, [activeDecks, selectedDeckId]);

  useEffect(() => {
    setActiveSlide(0);
    setNotesOpen(false);
  }, [selectedDeckId]);
  const importing = Boolean(
    latestJob &&
      latestJob.status !== "COMPLETED" &&
      latestJob.status !== "PARTIAL" &&
      latestJob.status !== "FAILED"
  );
  const displayedProgress = importing
    ? latestJob?.progressPercent ?? uploadProgress
    : uploadProgress;
  const selectedDeckTitle =
    decks.find((deck) => deck.id === selectedDeckId)?.title ?? "Материалы курса";

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
      toast.success("Заметка сохранена");
      void qc.invalidateQueries({ queryKey: ["content", courseId, "decks", selectedDeckId] });
    }
  });

  const clearNoteMut = useMutation({
    mutationFn: () =>
      deleteSlideNote(courseId, selectedDeckId, selectedDeck?.slides[activeSlide]?.idx ?? 1),
    onSuccess: () => {
      toast.success("Заметка очищена");
      void qc.invalidateQueries({ queryKey: ["content", courseId, "decks", selectedDeckId] });
    }
  });

  const archiveDeckMut = useMutation({
    mutationFn: (deckId: string) => archiveDeck(courseId, deckId),
    onSuccess: () => {
      setSelectedDeckId("");
      setLectureDeckId("");
      void qc.invalidateQueries({ queryKey: ["content", courseId, "decks"] });
    }
  });
  const restoreDeckMut = useMutation({
    mutationFn: (deckId: string) => restoreDeck(courseId, deckId),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["content", courseId, "decks"] })
  });
  const hardDeleteDeckMut = useMutation({
    mutationFn: (deckId: string) => hardDeleteDeck(courseId, deckId),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["content", courseId, "decks"] })
  });

  const deleteLectureMut = useMutation({
    mutationFn: (lectureId: string) => deleteLecture(courseId, lectureId),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["content", courseId, "lectures"] })
  });
  const restoreLectureMut = useMutation({
    mutationFn: (lectureId: string) => restoreLecture(courseId, lectureId),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["content", courseId, "lectures"] })
  });
  const hardDeleteLectureMut = useMutation({
    mutationFn: (lectureId: string) => hardDeleteLecture(courseId, lectureId),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["content", courseId, "lectures"] })
  });

  const startSessionMut = useMutation({
    mutationFn: (lectureId: string) => startLiveSession(courseId, lectureId),
    onMutate: (lectureId) => setStartingLectureId(lectureId),
    onSuccess: (session) => {
      void qc.invalidateQueries({ queryKey: ["active-session"] });
      navigate(`/courses/${courseId}/sessions/${session.id}/join`);
    },
    onSettled: () => setStartingLectureId("")
  });

  async function handleFile(file: File) {
    setError(null);
    const cleanTitle = title.trim();
    const effectiveTitle = cleanTitle || titleFromFileName(file.name);
    if (!cleanTitle) {
      setTitle(effectiveTitle);
      toast.warning(`Название взято из файла: ${effectiveTitle}`);
    }
    setFileName(file.name);
    setUploadProgress(1);
    try {
      const uploadedJob = await uploadDeck(courseId, effectiveTitle, file, setUploadProgress);
      setJob(uploadedJob);
      setUploadProgress(uploadedJob.progressPercent);
    } catch (err) {
      setError(userErrorMessage(err, "Не удалось загрузить файл."));
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

      {canManage && (
        <DeckUploadPanel
          title={title}
          fileName={fileName}
          dragOver={dragOver}
          progress={displayedProgress}
          importing={importing}
          error={error}
          phase={latestJob?.phase}
          processedSlides={latestJob?.processedSlides}
          totalSlides={latestJob?.totalSlides}
          warning={latestJob?.warningMessage}
          onTitleChange={setTitle}
          onFile={(file) => void handleFile(file)}
          onDragOverChange={setDragOver}
        />
      )}

      <DeckListPanel
        decks={decks}
        selectedDeckId={selectedDeckId}
        canManage={canManage}
        archivePending={archiveDeckMut.isPending}
        restorePending={restoreDeckMut.isPending}
        hardDeletePending={hardDeleteDeckMut.isPending}
        onSelect={(deckId) => {
          setSelectedDeckId(deckId);
          setLectureDeckId(deckId);
        }}
        onArchive={(deckId) => archiveDeckMut.mutate(deckId)}
        onRestore={(deckId) => restoreDeckMut.mutate(deckId)}
        onHardDelete={(deckId) => hardDeleteDeckMut.mutate(deckId)}
      />

      {selectedDeck && (
        <DeckViewer
          deck={selectedDeck}
          activeIndex={activeSlide}
          notesOpen={notesOpen}
          savingNote={saveNoteMut.isPending}
          onSlideChange={setActiveSlide}
          onNotesOpenChange={setNotesOpen}
          onSaveNote={(content) => saveNoteMut.mutateAsync(content).then(() => undefined)}
          onClearNote={() => clearNoteMut.mutate()}
        />
      )}

      <LectureList
        lectures={lectures}
        decks={activeDecks}
        canManage={canManage}
        title={lectureTitle}
        deckId={lectureDeckId}
        creating={createLectureMut.isPending}
        startingId={startingLectureId}
        onTitleChange={setLectureTitle}
        onDeckChange={setLectureDeckId}
        onCreate={() => createLectureMut.mutate()}
        onStart={(lectureId) => startSessionMut.mutate(lectureId)}
        onArchive={(lectureId) => deleteLectureMut.mutate(lectureId)}
        onRestore={(lectureId) => restoreLectureMut.mutate(lectureId)}
        onHardDelete={(lectureId) => hardDeleteLectureMut.mutate(lectureId)}
      />
    </div>
  );
}
