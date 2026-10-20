import { useEffect, useMemo, useRef, useState } from "react";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from "../shared/ui/dialog";
import { useDeckSlideActions } from "./useDeckSlideActions";
import { useSlideNoteActions } from "./useSlideNoteActions";
import { useLectureCreation } from "./useLectureCreation";

export function MaterialsPage({ courseId }: { courseId: string }) {
  const qc = useQueryClient();
  const [title, setTitle] = useState("");
  const [fileName, setFileName] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadingFile, setUploadingFile] = useState(false);
  const [uploadCompleted, setUploadCompleted] = useState(false);
  const [uploadedDeckId, setUploadedDeckId] = useState("");
  const [job, setJob] = useState<ImportJob | null>(null);
  const [selectedDeckId, setSelectedDeckId] = useState("");
  const [activeSlide, setActiveSlide] = useState(0);
  const [notesOpen, setNotesOpen] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lectureTitle, setLectureTitle] = useState("");
  const [lectureDeckId, setLectureDeckId] = useState("");
  const selectedDeckIdRef = useRef(selectedDeckId);
  const lectureDeckIdRef = useRef(lectureDeckId);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [lectureCreateOpen, setLectureCreateOpen] = useState(false);
  const [viewerOpen, setViewerOpen] = useState(false);
  const [partialDeckId, setPartialDeckId] = useState("");
  const [partialWarning, setPartialWarning] = useState("");
  const [partialReviewAccepted, setPartialReviewAccepted] = useState(false);
  const uploadRequestEpoch = useRef(0);
  const uploadInFlight = useRef(false);
  const currentCourseId = useRef(courseId);
  currentCourseId.current = courseId;
  selectedDeckIdRef.current = selectedDeckId;
  lectureDeckIdRef.current = lectureDeckId;
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
    uploadRequestEpoch.current += 1;
    uploadInFlight.current = false;
    setTitle("");
    setFileName("");
    setUploadProgress(0);
    setUploadingFile(false);
    setUploadCompleted(false);
    setUploadedDeckId("");
    setJob(null);
    setSelectedDeckId("");
    selectedDeckIdRef.current = "";
    setLectureDeckId("");
    lectureDeckIdRef.current = "";
    setActiveSlide(0);
    setNotesOpen(true);
    setError(null);
    setLectureTitle("");
    setUploadOpen(false);
    setLectureCreateOpen(false);
    setViewerOpen(false);
    setPartialDeckId("");
    setPartialWarning("");
    setPartialReviewAccepted(false);
    return () => {
      uploadRequestEpoch.current += 1;
      uploadInFlight.current = false;
    };
  }, [courseId]);
  useEffect(() => {
    if (!jobQuery.data) return;
    setJob(jobQuery.data);
    setUploadProgress(jobQuery.data.progressPercent);
    if (
      (jobQuery.data.status === "COMPLETED" || jobQuery.data.status === "PARTIAL") &&
      jobQuery.data.deckId
    ) {
      setUploadCompleted(jobQuery.data.status === "COMPLETED");
      setUploadedDeckId(jobQuery.data.deckId);
      if (!selectedDeckIdRef.current) {
        selectedDeckIdRef.current = jobQuery.data.deckId;
        setSelectedDeckId(jobQuery.data.deckId);
        setActiveSlide(0);
        setNotesOpen(true);
      }
      if (!lectureDeckIdRef.current) {
        lectureDeckIdRef.current = jobQuery.data.deckId;
        setLectureDeckId(jobQuery.data.deckId);
      }
      setJob(null);
      setUploadProgress(jobQuery.data.progressPercent);
      if (jobQuery.data.status === "PARTIAL") {
        setPartialDeckId(jobQuery.data.deckId);
        setPartialWarning(
          jobQuery.data.warningMessage ||
            `${jobQuery.data.processedSlides} из ${jobQuery.data.totalSlides ?? "всех"} слайдов удалось обработать. Проверьте результат перед сохранением лекции.`
        );
        setPartialReviewAccepted(false);
        toast.warning(
          jobQuery.data.warningMessage || jobQuery.data.errorMessage || "Импорт завершён частично"
        );
      } else {
        setPartialDeckId("");
        setPartialWarning("");
        setPartialReviewAccepted(false);
        toast.success("Импорт завершён. Проверьте презентацию и сохраните лекцию.");
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
    uploadingFile ||
      (latestJob &&
        latestJob.status !== "COMPLETED" &&
        latestJob.status !== "PARTIAL" &&
        latestJob.status !== "FAILED")
  );
  const displayedProgress = importing
    ? latestJob?.progressPercent ?? uploadProgress
    : uploadProgress;
  const createLectureMut = useLectureCreation(courseId, lectureTitle, lectureDeckId, () => {
    setLectureTitle("");
    setLectureCreateOpen(false);
  });
  const showLibrary = decks.length > 0 || lectures.length > 0;
  const openUpload = () => {
    if (!importing) {
      setUploadedDeckId("");
      setUploadCompleted(false);
      setTitle("");
      setFileName("");
      setError(null);
    }
    setUploadOpen(true);
  };
  const viewUploadedDeck = () => {
    setSelectedDeckId(uploadedDeckId);
    setActiveSlide(0);
    setNotesOpen(true);
    setUploadOpen(false);
    setViewerOpen(true);
  };
  const createFromDeck = (deckId: string, deckTitle: string) => {
    setLectureDeckId(deckId);
    setLectureTitle(deckTitle);
    setUploadOpen(false);
    setViewerOpen(false);
    setLectureCreateOpen(true);
  };
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
    hardDeleteLectureMut
  } = useMaterialsActions(courseId, () => {
    setSelectedDeckId("");
    setLectureDeckId("");
    setViewerOpen(false);
  });
  async function handleFile(file: File) {
    if (uploadInFlight.current) return;
    uploadInFlight.current = true;
    const requestEpoch = ++uploadRequestEpoch.current;
    const requestCourseId = courseId;
    const isCurrentRequest = () =>
      uploadRequestEpoch.current === requestEpoch && currentCourseId.current === requestCourseId;
    setJob(null);
    setUploadCompleted(false);
    setUploadedDeckId("");
    setUploadingFile(true);
    setError(null);
    setPartialDeckId("");
    setPartialWarning("");
    setPartialReviewAccepted(false);
    const cleanTitle = title.trim();
    const effectiveTitle = cleanTitle || titleFromFileName(file.name);
    if (!lectureTitle.trim()) setLectureTitle(effectiveTitle);
    if (!cleanTitle) {
      setTitle(effectiveTitle);
    }
    setFileName(file.name);
    setUploadProgress(1);
    setUploadOpen(true);
    try {
      const uploadedJob = await uploadDeck(courseId, effectiveTitle, file, (progress) => {
        if (isCurrentRequest()) setUploadProgress(progress);
      });
      if (!isCurrentRequest()) return;
      setJob(uploadedJob);
      setUploadProgress(uploadedJob.progressPercent);
    } catch (err) {
      if (!isCurrentRequest()) return;
      setError(userErrorMessage(err, "Не удалось загрузить файл."));
      setUploadProgress(0);
    } finally {
      if (isCurrentRequest()) {
        uploadInFlight.current = false;
        setUploadingFile(false);
      }
    }
  }

  if (viewerOpen && (deckQuery.isLoading || deckQuery.isError)) {
    return (
      <div className="page page--wide preparation-page">
        <Button variant="ghost" onClick={() => setViewerOpen(false)}>
          ← Лекции и материалы
        </Button>
        {deckQuery.isError ? (
          <div role="alert">
            <p>Не удалось открыть презентацию.</p>
            <Button variant="outline" onClick={() => void deckQuery.refetch()}>
              Повторить
            </Button>
          </div>
        ) : (
          <p role="status">Загрузка презентации…</p>
        )}
      </div>
    );
  }

  if (viewerOpen && selectedDeck && selectedDeck.id === selectedDeckId) {
    return (
      <div className="page page--wide preparation-page materials-page materials-page--viewer">
        <header className="page-header preparation-viewer-header">
          <div>
            <button type="button" className="breadcrumb" onClick={() => setViewerOpen(false)}>
              ← Лекции и материалы
            </button>
            <h1>{selectedDeck.title}</h1>
            <p className="muted">
              Версия {selectedDeck.version} · {selectedDeck.slides.length} слайдов
            </p>
          </div>
          <Button type="button" variant="outline" onClick={() => setViewerOpen(false)}>
            <X size={18} aria-hidden="true" /> Закрыть просмотр
          </Button>
          {canManage && !selectedDeck.archived && (
            <Button onClick={() => createFromDeck(selectedDeck.id, selectedDeck.title)}>
              Создать лекцию
            </Button>
          )}
        </header>
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
    );
  }

  return (
    <div className="page page--wide course-workflows materials-page preparation-page">
      <header className="page-header course-workflow-header">
        <div className="course-workflow-header__copy">
          <Link to={`/courses/${courseId}`} className="breadcrumb">
            ← Курсы / {courseQuery.data?.title ?? "Курс"}
          </Link>
          <h1>Лекции и материалы</h1>
        </div>
      </header>

      <CourseSectionNav courseId={courseId} canManage={canManage} />

      {courseQuery.isError && (
        <div className="materials-load-error" role="alert">
          <p>Не удалось загрузить курс и его материалы.</p>
          <Button type="button" variant="outline" onClick={() => void courseQuery.refetch()}>
            Повторить
          </Button>
        </div>
      )}

      {(lecturesQuery.isLoading || decksQuery.isLoading) && !courseQuery.isError && (
        <p className="muted preparation-loading" role="status">
          Загрузка лекций и презентаций…
        </p>
      )}
      {!courseQuery.isError &&
        !lecturesQuery.isLoading &&
        !decksQuery.isLoading &&
        !lecturesQuery.isError &&
        !decksQuery.isError && (
          <LectureList
            courseId={courseId}
            lectures={lectures}
            decks={activeDecks}
            canManage={canManage}
            title={lectureTitle}
            deckId={lectureDeckId}
            creating={createLectureMut.isPending}
            createError={
              createLectureMut.error
                ? userErrorMessage(createLectureMut.error, "Не удалось сохранить лекцию.")
                : null
            }
            createOpen={lectureCreateOpen}
            onCreateOpenChange={setLectureCreateOpen}
            onTitleChange={setLectureTitle}
            onDeckChange={setLectureDeckId}
            onCreate={() => createLectureMut.mutate()}
            onArchive={(lectureId) => deleteLectureMut.mutate(lectureId)}
            onRestore={(lectureId) => restoreLectureMut.mutate(lectureId)}
            onHardDelete={(lectureId) => hardDeleteLectureMut.mutate(lectureId)}
            onAddPresentation={openUpload}
            onOpenDeck={(deckId) => {
              setSelectedDeckId(deckId);
              setActiveSlide(0);
              setNotesOpen(true);
              setViewerOpen(true);
            }}
            partialImportWarning={lectureDeckId === partialDeckId ? partialWarning : undefined}
            partialReviewAccepted={partialReviewAccepted}
            onPartialReviewAccepted={setPartialReviewAccepted}
          />
        )}

      {lecturesQuery.isError && !courseQuery.isError && (
        <div className="materials-load-error" role="alert">
          <p>Не удалось загрузить готовые лекции. Пустой список пока не подтверждён.</p>
          <Button type="button" variant="outline" onClick={() => void lecturesQuery.refetch()}>
            Повторить
          </Button>
        </div>
      )}
      {decksQuery.isError && !courseQuery.isError && (
        <div className="materials-load-error" role="alert">
          <p>Не удалось загрузить презентации. Пустой список пока не подтверждён.</p>
          <Button type="button" variant="outline" onClick={() => void decksQuery.refetch()}>
            Повторить
          </Button>
        </div>
      )}

      {!courseQuery.isError && (
        <section className="materials-workspace" aria-label="Презентации курса">
          {showLibrary && (
            <div className="section-heading materials-workspace__heading">
              <div>
                <h2 id="materials-workspace-title">Библиотека презентаций</h2>
                <p className="muted">Файлы слайдов, версии и заметки преподавателя.</p>
              </div>
              {canManage && (
                <Button type="button" onClick={openUpload}>
                  <Plus size={16} aria-hidden="true" />
                  Добавить презентацию
                </Button>
              )}
            </div>
          )}

          {canManage && (
            <>
              <Dialog open={uploadOpen} onOpenChange={setUploadOpen}>
                <DialogContent
                  className="materials-dialog materials-upload-dialog"
                  aria-labelledby="deck-upload-dialog-title"
                  onOpenAutoFocus={(event) => {
                    event.preventDefault();
                    document.getElementById("deck-upload-dialog-title")?.focus({
                      preventScroll: true
                    });
                  }}
                >
                  <DialogHeader>
                    <DialogTitle id="deck-upload-dialog-title" tabIndex={-1} data-dialog-heading>
                      {uploadedDeckId ? "Презентация готова" : "Добавить презентацию"}
                    </DialogTitle>
                    <DialogDescription>
                      {uploadedDeckId
                        ? "Посмотрите слайды или создайте лекцию из загруженной презентации."
                        : "Выберите PowerPoint, ODP или PDF. Импорт начнётся после выбора файла."}
                    </DialogDescription>
                  </DialogHeader>
                  <div className="materials-dialog__body">
                    {!uploadedDeckId && (
                      <DeckUploadPanel
                        title={title}
                        fileName={fileName}
                        dragOver={dragOver}
                        progress={displayedProgress}
                        importing={importing}
                        error={
                          error ??
                          (jobQuery.isError ? "Не удалось проверить состояние импорта." : null)
                        }
                        phase={latestJob?.phase}
                        processedSlides={latestJob?.processedSlides}
                        totalSlides={latestJob?.totalSlides}
                        warning={fileName ? partialWarning || latestJob?.warningMessage : undefined}
                        onTitleChange={setTitle}
                        onFile={(file) => void handleFile(file)}
                        onDragOverChange={setDragOver}
                      />
                    )}
                    {uploadedDeckId && (
                      <div className="materials-upload-result">
                        <p
                          className={partialWarning ? "form-warning" : "materials-upload-success"}
                          role="status"
                        >
                          {partialWarning ||
                            `«${title}» сохранена. Можно переходить к подготовке занятия.`}
                        </p>
                        <div className="lecture-create-actions">
                          <Button variant="outline" onClick={viewUploadedDeck}>
                            Посмотреть слайды
                          </Button>
                          <Button onClick={() => createFromDeck(uploadedDeckId, title)}>
                            Создать лекцию
                          </Button>
                        </div>
                        <Button variant="ghost" onClick={openUpload}>
                          Загрузить ещё
                        </Button>
                      </div>
                    )}
                    {jobQuery.isError && (
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => void jobQuery.refetch()}
                      >
                        Проверить импорт ещё раз
                      </Button>
                    )}
                  </div>
                </DialogContent>
              </Dialog>
              {(importing ||
                Boolean(error) ||
                jobQuery.isError ||
                Boolean(partialWarning) ||
                uploadCompleted) && (
                <div
                  className={`materials-upload-status${uploadOpen ? " materials-upload-status--behind-dialog" : ""}`}
                  aria-hidden={uploadOpen || undefined}
                  role={error || jobQuery.isError ? "alert" : "status"}
                >
                  <span>
                    {error ||
                      (jobQuery.isError
                        ? "Не удалось проверить состояние импорта."
                        : importing
                          ? `Импорт презентации продолжается: ${displayedProgress}%.`
                          : partialWarning
                            ? "Презентация импортирована частично, проверьте слайды перед созданием лекции."
                            : "Импорт завершён. Презентация сохранена в материалах курса.")}
                  </span>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={uploadedDeckId ? viewUploadedDeck : () => setUploadOpen(true)}
                  >
                    {uploadedDeckId ? "Посмотреть слайды" : "Открыть импорт"}
                  </Button>
                  {jobQuery.isError && (
                    <Button type="button" variant="ghost" onClick={() => void jobQuery.refetch()}>
                      Проверить ещё раз
                    </Button>
                  )}
                </div>
              )}
            </>
          )}

          {deckQuery.isError && (
            <div className="materials-load-error" role="alert">
              <p>Не удалось открыть презентацию и проверить её слайды.</p>
              <Button type="button" variant="outline" onClick={() => void deckQuery.refetch()}>
                Повторить
              </Button>
            </div>
          )}

          {showLibrary && !decksQuery.isError && !decksQuery.isLoading && (
            <DeckListPanel
              decks={decks}
              lectures={lecturesQuery.isSuccess ? lectures : undefined}
              selectedDeckId={selectedDeckId}
              canManage={canManage}
              archivePending={archiveDeckMut.isPending}
              restorePending={restoreDeckMut.isPending}
              hardDeletePending={hardDeleteDeckMut.isPending}
              onSelect={(deckId) => {
                setSelectedDeckId(deckId);
                setLectureDeckId(deckId);
                setActiveSlide(0);
                setNotesOpen(true);
                setViewerOpen(true);
              }}
              onArchive={(deckId) => archiveDeckMut.mutate(deckId)}
              onRestore={(deckId) => restoreDeckMut.mutate(deckId)}
              onHardDelete={(deckId) => hardDeleteDeckMut.mutate(deckId)}
            />
          )}
        </section>
      )}
    </div>
  );
}
