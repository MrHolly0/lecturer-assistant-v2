import type { ReactNode } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { toast } from "sonner";
import { getDeck } from "../app/api/content-api";
import {
  changeLiveSessionSlide,
  getLiveSession,
  listSessionParticipants,
  type LiveSession
} from "../app/api/live-api";
import { ApiError, userErrorMessage } from "../app/api/errors";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../shared/ui/tabs";
import { Button } from "../shared/ui/button";
import { PollPanel } from "./PollPanel";
import { LiveSlideNotesEditor } from "./LiveSlideNotesEditor";
import { SessionParticipantList } from "./SessionParticipantList";

export type LectureRemoteSection = "questions" | "poll" | "students" | "notes";

export function LectureRemoteTools({
  courseId,
  session,
  disabled,
  section,
  onSectionChange,
  onSessionChange,
  container,
  noteDrafts,
  onNoteDraftChange,
  newQuestionCount = 0,
  children
}: {
  courseId: string;
  session: LiveSession;
  disabled: boolean;
  section: LectureRemoteSection;
  onSectionChange: (section: LectureRemoteSection) => void;
  onSessionChange?: (session: LiveSession) => void;
  container: HTMLElement;
  noteDrafts: Record<number, string>;
  onNoteDraftChange: (idx: number, content?: string, expected?: string) => void;
  newQuestionCount?: number;
  children: ReactNode;
}) {
  const deck = useQuery({
    queryKey: ["content", courseId, "decks", session.deckId],
    queryFn: () => getDeck(courseId, session.deckId),
    enabled: Boolean(session.deckId)
  });
  const participants = useQuery({
    queryKey: ["live", courseId, session.id, "participants"],
    queryFn: () => listSessionParticipants(courseId, session.id),
    refetchInterval: 3000,
    refetchIntervalInBackground: true
  });
  const active = participants.data?.filter((person) => !person.leftAt && !person.kicked) ?? [];
  const slide = deck.data?.slides.find((item) => item.idx === session.currentSlideIdx);
  const slideCount = deck.data?.slides.length ?? 0;
  const changeSlide = useMutation({
    mutationFn: (idx: number) => changeLiveSessionSlide(courseId, session.id, idx, session.version),
    onSuccess: onSessionChange,
    onError: (error) => {
      if (error instanceof ApiError && error.status === 409)
        void getLiveSession(courseId, session.id)
          .then(onSessionChange)
          .catch(() => undefined);
      toast.error(userErrorMessage(error, "Не удалось переключить слайд."));
    }
  });
  return (
    <>
      {slideCount > 0 && (
        <nav className="floating-remote-slides" aria-label="Слайды занятия">
          <Button
            variant="outline"
            size="icon"
            aria-label="Предыдущий слайд"
            disabled={
              disabled ||
              session.status === "PAUSED" ||
              changeSlide.isPending ||
              session.currentSlideIdx <= 1
            }
            onClick={() => changeSlide.mutate(session.currentSlideIdx - 1)}
          >
            <ChevronLeft size={18} />
          </Button>
          <span>
            Слайд {session.currentSlideIdx} из {slideCount}
          </span>
          <Button
            variant="outline"
            size="icon"
            aria-label="Следующий слайд"
            disabled={
              disabled ||
              session.status === "PAUSED" ||
              changeSlide.isPending ||
              session.currentSlideIdx >= slideCount
            }
            onClick={() => changeSlide.mutate(session.currentSlideIdx + 1)}
          >
            <ChevronRight size={18} />
          </Button>
        </nav>
      )}
      <Tabs
        className="floating-remote-tools"
        value={section}
        onValueChange={(value) => onSectionChange(value as LectureRemoteSection)}
      >
        <TabsList aria-label="Инструменты пульта">
          <TabsTrigger value="questions">
            Вопросы
            {newQuestionCount > 0 && (
              <span className="floating-remote-tab-count">{newQuestionCount}</span>
            )}
          </TabsTrigger>
          <TabsTrigger value="poll">Проверка</TabsTrigger>
          <TabsTrigger value="students">
            Участники{active.length > 0 ? ` (${active.length})` : ""}
          </TabsTrigger>
          <TabsTrigger value="notes">Заметки</TabsTrigger>
        </TabsList>
        <TabsContent value="questions" forceMount hidden={section !== "questions"}>
          {children}
        </TabsContent>
        <TabsContent value="poll" forceMount hidden={section !== "poll"}>
          <PollPanel
            courseId={courseId}
            sessionId={session.id}
            container={container}
            disabled={session.status === "PAUSED"}
            commandsBlocked={disabled}
            background
          />
        </TabsContent>
        <TabsContent value="students" forceMount hidden={section !== "students"}>
          {participants.isLoading && <p role="status">Загружаем участников…</p>}
          {participants.isError && (
            <div className="action-message" role="alert">
              <p>Не удалось обновить участников.</p>
              <Button variant="outline" onClick={() => void participants.refetch()}>
                Повторить
              </Button>
            </div>
          )}
          {!participants.isLoading && (
            <SessionParticipantList
              courseId={courseId}
              sessionId={session.id}
              participants={participants.data ?? []}
              disabled={disabled}
              confirmationContainer={container}
            />
          )}
        </TabsContent>
        <TabsContent value="notes" forceMount hidden={section !== "notes"}>
          <p className="floating-remote-hint">
            Заметки к слайду {session.currentSlideIdx}. Видны только вам.
          </p>
          {deck.isLoading && <p role="status">Загружаем заметки…</p>}
          {deck.isError && (
            <div className="action-message" role="alert">
              <p>Не удалось загрузить заметки.</p>
              <Button variant="outline" onClick={() => void deck.refetch()}>
                Повторить
              </Button>
            </div>
          )}
          {slide && (
            <LiveSlideNotesEditor
              courseId={courseId}
              deckId={session.deckId}
              slide={slide}
              draft={noteDrafts[slide.idx]}
              onDraftChange={onNoteDraftChange}
            />
          )}
          {!session.deckId && <p className="muted">Для заметок нужна презентация занятия.</p>}
        </TabsContent>
      </Tabs>
    </>
  );
}
