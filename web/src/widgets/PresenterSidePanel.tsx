import { AlertTriangle, Clock } from "lucide-react";
import type { Slide } from "../app/api/content-api";
import type { LiveSession, SessionParticipant } from "../app/api/live-api";
import type { SignalValue, StudentEngagement } from "../app/api/student-api";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../shared/ui/tabs";

interface PresenterSidePanelProps {
  session: LiveSession;
  slide: Slide;
  participants: SessionParticipant[];
  engagement?: StudentEngagement;
  elapsed: number;
  slideElapsed: number;
}

export function PresenterSidePanel({
  session,
  slide,
  participants,
  engagement,
  elapsed,
  slideElapsed
}: PresenterSidePanelProps) {
  const activeParticipants = participants.filter((participant) => !participant.leftAt);
  const signals = engagement?.signalAggregate;
  const questions = engagement?.questions ?? [];
  const redCount = signals?.red ?? 0;

  return (
    <aside className="presenter-side">
      <div className="live-metric">
        <Clock size={16} />
        Лекция {formatTime(elapsed)} · слайд {formatTime(slideElapsed)}
      </div>
      <div className="join-panel">
        <span className="muted">Код подключения</span>
        <strong>{session.joinCode}</strong>
        <small>Кнопка «Подключение» сверху — QR и ссылки для веба, Telegram и ВК.</small>
      </div>
      {redCount > 0 && (
        <div className="signal-alert">
          <AlertTriangle size={14} />
          {redCount} {pluralStudents(redCount)} не {redCount === 1 ? "понимает" : "понимают"}
        </div>
      )}
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
            <span className="badge">{activeParticipants.length} на связи</span>
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
          <div className="signal-summary">
            <div className="section-heading">
              <h2>Светофор</h2>
              <span className="muted">{signals?.total ?? 0} сигналов</span>
            </div>
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
          </div>
        </TabsContent>
        <TabsContent value="notes" className="live-panel">
          <div className="section-heading">
            <h2>Заметки</h2>
            <span className="muted">слайд {slide.idx}</span>
          </div>
          <p className="presenter-note">{slide.note?.content || "Для этого слайда заметок нет."}</p>
        </TabsContent>
        <TabsContent value="questions" className="live-panel">
          <div className="section-heading">
            <h2>Вопросы</h2>
            <span className="badge">{questions.length} открыто</span>
          </div>
          {questions.length === 0 && <p className="muted">Открытых вопросов пока нет.</p>}
          {questions.length > 0 && (
            <ul className="live-question-list">
              {questions.map((question) => (
                <li key={question.id}>
                  <p>{question.text}</p>
                  <small>
                    {question.displayName} ·{" "}
                    {new Date(question.createdAt).toLocaleTimeString("ru-RU", {
                      hour: "2-digit",
                      minute: "2-digit"
                    })}
                  </small>
                </li>
              ))}
            </ul>
          )}
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

function formatTime(total: number) {
  const minutes = Math.floor(total / 60)
    .toString()
    .padStart(2, "0");
  const seconds = (total % 60).toString().padStart(2, "0");
  return `${minutes}:${seconds}`;
}

function pluralStudents(n: number) {
  if (n % 10 === 1 && n % 100 !== 11) return "студент";
  if (n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20)) return "студента";
  return "студентов";
}
