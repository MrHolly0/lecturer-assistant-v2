import { Clock } from "lucide-react";
import type { Slide } from "../app/api/content-api";
import type { SessionParticipant } from "../app/api/live-api";
import type { SignalValue, StudentEngagement } from "../app/api/student-api";
import { pluralizeRu } from "../shared/lib/plural";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../shared/ui/tabs";
import { PollPanel } from "./PollPanel";
import { formatSessionTime } from "../app/live/useSessionTimers";
import {
  PresenterNotesActions,
  PresenterNotesDockedEditor,
  PresenterNotesWorkspace
} from "./PresenterTools";
import { TeacherRemoteQuestions } from "./TeacherRemoteQuestions";
import { SessionParticipantList } from "./SessionParticipantList";

interface PresenterSidePanelProps {
  slide: Slide;
  participants: SessionParticipant[];
  engagement?: StudentEngagement;
  elapsed: number;
  slideElapsed: number;
  courseId: string;
  sessionId: string;
  paused: boolean;
  commandsBlocked?: boolean;
  questionsLoading?: boolean;
  questionsError?: boolean;
  onRetryQuestions?: () => void;
  engagementLoading?: boolean;
  engagementError?: boolean;
  onRetryEngagement?: () => void;
  participantsError?: boolean;
  onRetryParticipants?: () => void;
}

export function PresenterSidePanel({
  slide,
  participants,
  engagement,
  elapsed,
  slideElapsed,
  courseId,
  sessionId,
  paused,
  commandsBlocked = false,
  questionsLoading = false,
  questionsError = false,
  onRetryQuestions,
  engagementLoading = false,
  engagementError = false,
  onRetryEngagement,
  participantsError = false,
  onRetryParticipants
}: PresenterSidePanelProps) {
  const activeParticipants = participants.filter(
    (participant) => !participant.leftAt && !participant.kicked
  );
  const signals = engagement?.signalAggregate;
  const questions = engagement?.questions ?? [];

  return (
    <PresenterNotesWorkspace
      key={`${courseId}:${sessionId}:${slide.deckId}`}
      courseId={courseId}
      slide={slide}
    >
      <aside className="presenter-side">
        <section className="live-panel signal-summary signal-summary--primary">
          <div className="section-heading">
            <h2>Понимание слайда {slide.idx}</h2>
            <span className="muted">
              {activeParticipants.length}{" "}
              {pluralizeRu(activeParticipants.length, "участник", "участника", "участников")}
            </span>
          </div>
          {engagementError && engagement && (
            <div className="teacher-remote-data-error" role="status">
              Не удалось обновить сигналы. Показаны последние данные.{" "}
              <button type="button" onClick={onRetryEngagement}>
                Повторить
              </button>
            </div>
          )}
          {engagement ? (
            <>
              <SignalRow
                label="Понятно"
                value="GREEN"
                total={signals?.total ?? 0}
                signals={signals}
              />
              <SignalRow
                label="Есть вопрос"
                value="YELLOW"
                total={signals?.total ?? 0}
                signals={signals}
              />
              <SignalRow
                label="Не понимаю"
                value="RED"
                total={signals?.total ?? 0}
                signals={signals}
              />
            </>
          ) : (
            <div className="teacher-remote-data-error" role={engagementError ? "alert" : "status"}>
              {engagementError
                ? "Не удалось загрузить понимание."
                : engagementLoading
                  ? "Загружаем сигналы…"
                  : "Сигналов пока нет."}{" "}
              {engagementError && (
                <button type="button" onClick={onRetryEngagement}>
                  Повторить
                </button>
              )}
            </div>
          )}
        </section>
        <Tabs defaultValue="questions" className="live-tabs">
          <TabsList className="live-tabs__list">
            <TabsTrigger value="questions">
              Вопросы
              {questions.filter((question) => question.status === "OPEN").length > 0 && (
                <span className="tab-badge tab-badge--alert">
                  {questions.filter((question) => question.status === "OPEN").length}
                </span>
              )}
            </TabsTrigger>
            <TabsTrigger value="poll">Проверка</TabsTrigger>
            <TabsTrigger value="students">
              Студенты
              {activeParticipants.length > 0 && (
                <span className="tab-badge">{activeParticipants.length}</span>
              )}
            </TabsTrigger>
            <TabsTrigger value="notes">Заметки</TabsTrigger>
          </TabsList>
          <TabsContent value="poll" className="live-panel live-poll-panel">
            <PollPanel
              courseId={courseId}
              sessionId={sessionId}
              disabled={paused}
              commandsBlocked={commandsBlocked}
            />
          </TabsContent>
          <TabsContent value="students" className="live-panel">
            {participantsError && (
              <div className="teacher-remote-data-error" role="status">
                Не удалось обновить участников.{" "}
                {participants.length > 0 ? "Показаны последние данные." : ""}{" "}
                <button type="button" onClick={onRetryParticipants}>
                  Повторить
                </button>
              </div>
            )}
            <div className="section-heading">
              <h2>Студенты</h2>
              <span className="badge">
                {activeParticipants.length}{" "}
                {pluralizeRu(activeParticipants.length, "студент", "студента", "студентов")} на
                связи
              </span>
            </div>
            <SessionParticipantList
              courseId={courseId}
              sessionId={sessionId}
              participants={participants}
              disabled={commandsBlocked}
            />
          </TabsContent>
          <TabsContent value="notes" className="live-panel">
            <div className="section-heading">
              <h2>Заметки</h2>
              <span className="muted">слайд {slide.idx}</span>
            </div>
            <p className="question-privacy-hint">
              Видны только вам. На проекторе и у студентов их нет.
            </p>
            <PresenterNotesActions />
            <PresenterNotesDockedEditor />
          </TabsContent>
          <TabsContent value="questions" className="live-panel">
            <TeacherRemoteQuestions
              courseId={courseId}
              sessionId={sessionId}
              questions={questions}
              isLoading={questionsLoading}
              loadError={questionsError}
              onRetry={onRetryQuestions}
              disabled={commandsBlocked}
            />
          </TabsContent>
        </Tabs>
        <div className="live-metric">
          <Clock size={16} />С начала {formatSessionTime(elapsed)} · слайд{" "}
          {formatSessionTime(slideElapsed)}
        </div>
      </aside>
    </PresenterNotesWorkspace>
  );
}

function SignalRow({
  label,
  value,
  total,
  signals
}: {
  label: string;
  value: SignalValue;
  total: number;
  signals?: StudentEngagement["signalAggregate"];
}) {
  const key = value.toLowerCase() as "green" | "yellow" | "red";
  const count = signals?.[key] ?? 0;
  const percent = total > 0 ? Math.round((count / total) * 100) : 0;

  return (
    <div className="signal-row">
      <span>{label}</span>
      <div className="signal-row__track">
        <span
          className={`signal-row__bar signal-row__bar--${key}`}
          style={{ width: `${percent}%` }}
        />
      </div>
      <strong>{count}</strong>
    </div>
  );
}
