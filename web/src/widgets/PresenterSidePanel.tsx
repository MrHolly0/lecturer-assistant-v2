import { AlertTriangle, Clock } from "lucide-react";
import type { Slide } from "../app/api/content-api";
import type { SessionParticipant } from "../app/api/live-api";
import type { SignalValue, StudentEngagement } from "../app/api/student-api";
import { pluralizeRu } from "../shared/lib/plural";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../shared/ui/tabs";
import { PollPanel } from "./PollPanel";
import { formatSessionTime } from "../app/live/useSessionTimers";
import { LiveSlideNotesEditor } from "./LiveSlideNotesEditor";
import { TeacherRemoteQuestions } from "./TeacherRemoteQuestions";

interface PresenterSidePanelProps {
  slide: Slide;
  participants: SessionParticipant[];
  engagement?: StudentEngagement;
  elapsed: number;
  slideElapsed: number;
  courseId: string;
  sessionId: string;
  paused: boolean;
}

export function PresenterSidePanel({
  slide,
  participants,
  engagement,
  elapsed,
  slideElapsed,
  courseId,
  sessionId,
  paused
}: PresenterSidePanelProps) {
  const activeParticipants = participants.filter((participant) => !participant.leftAt);
  const signals = engagement?.signalAggregate;
  const questions = engagement?.questions ?? [];
  const redCount = signals?.red ?? 0;

  return (
    <aside className="presenter-side">
      <div className="live-metric">
        <Clock size={16} />С начала {formatSessionTime(elapsed)} · слайд{" "}
        {formatSessionTime(slideElapsed)}
      </div>
      {redCount > 0 && (
        <div className="signal-alert">
          <AlertTriangle size={14} />
          {redCount} {pluralizeRu(redCount, "студент", "студента", "студентов")} не{" "}
          {redCount === 1 ? "понимает" : "понимают"}
        </div>
      )}
      <section className="live-panel signal-summary signal-summary--primary">
        <div className="section-heading">
          <h2>Понимание слайда {slide.idx}</h2>
          <span className="muted">
            {signals?.total ?? 0}{" "}
            {pluralizeRu(signals?.total ?? 0, "сигнал", "сигнала", "сигналов")}
          </span>
        </div>
        <SignalRow label="Понятно" value="GREEN" total={signals?.total ?? 0} signals={signals} />
        <SignalRow
          label="Есть вопрос"
          value="YELLOW"
          total={signals?.total ?? 0}
          signals={signals}
        />
        <SignalRow label="Не понимаю" value="RED" total={signals?.total ?? 0} signals={signals} />
      </section>
      <section className="live-poll-panel">
        <div className="section-heading">
          <h2>Вопрос-проверка</h2>
        </div>
        <PollPanel courseId={courseId} sessionId={sessionId} disabled={paused} />
      </section>
      <Tabs defaultValue="students" className="live-tabs">
        <TabsList className="live-tabs__list">
          <TabsTrigger value="students">
            Студенты
            {activeParticipants.length > 0 && (
              <span className="tab-badge">{activeParticipants.length}</span>
            )}
          </TabsTrigger>
          <TabsTrigger value="notes">Заметки</TabsTrigger>
          <TabsTrigger value="questions">
            Вопросы
            {questions.length > 0 && (
              <span className="tab-badge tab-badge--alert">{questions.length}</span>
            )}
          </TabsTrigger>
        </TabsList>
        <TabsContent value="students" className="live-panel">
          <div className="section-heading">
            <h2>Студенты</h2>
            <span className="badge">
              {activeParticipants.length}{" "}
              {pluralizeRu(activeParticipants.length, "студент", "студента", "студентов")} на связи
            </span>
          </div>
          {activeParticipants.length === 0 && <p className="muted">Пока никто не подключился.</p>}
          {activeParticipants.length > 0 && (
            <ul className="participant-list">
              {activeParticipants.map((participant) => (
                <li key={`${participant.personId}-${participant.channelType}`}>
                  <span>{participant.displayName}</span>
                  <small>
                    {participant.channelType} ·{" "}
                    {new Date(participant.joinedAt).toLocaleTimeString("ru-RU", {
                      hour: "2-digit",
                      minute: "2-digit"
                    })}
                  </small>
                </li>
              ))}
            </ul>
          )}
        </TabsContent>
        <TabsContent value="notes" className="live-panel">
          <div className="section-heading">
            <h2>Заметки</h2>
            <span className="muted">слайд {slide.idx}</span>
          </div>
          <LiveSlideNotesEditor courseId={courseId} deckId={slide.deckId} slide={slide} />
        </TabsContent>
        <TabsContent value="questions" className="live-panel">
          <TeacherRemoteQuestions courseId={courseId} sessionId={sessionId} questions={questions} />
        </TabsContent>
      </Tabs>
    </aside>
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
