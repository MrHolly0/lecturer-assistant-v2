import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, X } from "lucide-react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { userErrorMessage } from "../app/api/errors";
import {
  getDeck,
  getImportJob,
  listDecks,
  listLectures,
  uploadDeck,
  type ImportJob
} from "../app/api/content-api";
import { getCourse } from "../app/api/courses-api";
import { DeckUploadPanel } from "../widgets/DeckUploadPanel";
import { DeckViewer } from "../widgets/DeckViewer";
import { LectureList } from "../widgets/LectureList";
import { DeckListPanel } from "../widgets/DeckListPanel";
import { titleFromFileName } from "../shared/lib/fileName";
import { CourseSectionNav } from "../widgets/CourseSectionNav";
import { useMaterialsActions } from "./useMaterialsActions";
import { Button } from "../shared/ui/button";
import { useDeckSlideActions } from "./useDeckSlideActions";
import { useSlideNoteActions } from "./useSlideNoteActions";
import { useLectureCreation } from "./useLectureCreation";

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
  const [uploadOpen, setUploadOpen] = useState(false);
  const [viewerOpen, setViewerOpen] = useState(false);
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
    setUploadOpen(false);
    setViewerOpen(false);
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
      setActiveSlide(0);
      setNotesOpen(false);
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
  const importing = Boolean(
    latestJob &&
      latestJob.status !== "COMPLETED" &&
      latestJob.status !== "PARTIAL" &&
      latestJob.status !== "FAILED"
  );
  const displayedProgress = importing
    ? latestJob?.progressPercent ?? uploadProgress
    : uploadProgress;
  const createLectureMut = useLectureCreation(courseId, lectureTitle, lectureDeckId, () =>
    setLectureTitle("")
  );
  const noteActions = useSlideNoteActions(courseId, selectedDeck, activeSlide);
  const slideActions = useDeckSlideActions({
    courseId,
    deck: selectedDeck,
    activeIndex: activeSlide,
    onDeckSelected: (deckId) => {
      setSelectedDeckId(deckId);
      setLectureDeckId(deckId);
    },
    onActiveIndexChange: setActiveSlide
  });
  const {
    archiveDeckMut,
    restoreDeckMut,
    hardDeleteDeckMut,
    deleteLectureMut,
    restoreLectureMut,
    hardDeleteLectureMut,
    startSessionMut,
    startingLectureId
  } = useMaterialsActions(courseId, () => {
    setSelectedDeckId("");
    setLectureDeckId("");
    setViewerOpen(false);
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
    setUploadOpen(true);
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
        <span className="muted">{courseQuery.data?.title}</span>
      </div>

      <CourseSectionNav courseId={courseId} canManage={canManage} />

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
        onAddPresentation={() => setUploadOpen(true)}
      />

      <section className="materials-workspace" aria-labelledby="materials-workspace-title">
        <div className="section-heading materials-workspace__heading">
          <div>
            <h2 id="materials-workspace-title">Презентации</h2>
            <p className="muted">Файлы слайдов, версии и заметки преподавателя.</p>
          </div>
          {canManage && activeDecks.length > 0 && (
            <Button
              type="button"
              variant="outline"
              disabled={importing}
              onClick={() => setUploadOpen((value) => !value)}
            >
              {uploadOpen ? (
                <X size={16} aria-hidden="true" />
              ) : (
                <Plus size={16} aria-hidden="true" />
              )}
              {uploadOpen ? "Скрыть загрузку" : "Добавить презентацию"}
            </Button>
          )}
        </div>

        {canManage && (uploadOpen || importing || Boolean(error)) && (
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
            setActiveSlide(0);
            setNotesOpen(false);
            setViewerOpen(true);
          }}
          onArchive={(deckId) => archiveDeckMut.mutate(deckId)}
          onRestore={(deckId) => restoreDeckMut.mutate(deckId)}
          onHardDelete={(deckId) => hardDeleteDeckMut.mutate(deckId)}
        />

        {selectedDeck && viewerOpen && (
          <div className="material-viewer-shell">
            <Button
              type="button"
              variant="ghost"
              className="material-viewer-close"
              onClick={() => setViewerOpen(false)}
            >
              <X size={16} aria-hidden="true" /> Закрыть просмотр
            </Button>
            <DeckViewer
              deck={selectedDeck}
              activeIndex={activeSlide}
              notesOpen={notesOpen}
              savingNote={noteActions.saving}
              canManage={canManage}
              editing={slideActions.editing}
              onSlideChange={setActiveSlide}
              onNotesOpenChange={setNotesOpen}
              onSaveNote={(content) => noteActions.save(content).then(() => undefined)}
              onClearNote={() => noteActions.clear()}
              onReorderSlide={slideActions.reorderSlide}
              onDeleteSlide={slideActions.deleteActiveSlide}
            />
          </div>
        )}
      </section>
    </div>
  );
}
