import { useMemo } from "react";
import { Clock } from "lucide-react";
import type { Slide } from "../app/api/content-api";
import type { LiveSession, SessionParticipant } from "../app/api/live-api";
import type { SignalValue, StudentEngagement } from "../app/api/student-api";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../shared/ui/tabs";
import { LocalQrCode } from "./LocalQrCode";

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
  const joinUrl = useMemo(() => {
    if (typeof window === "undefined") return `#/s/${session.joinCode}`;
    return `${window.location.origin}${window.location.pathname}#/s/${session.joinCode}`;
  }, [session.joinCode]);
  const signals = engagement?.signalAggregate;
  const questions = engagement?.questions ?? [];

  return (
    <aside className="presenter-side">
      <div className="live-metric">
        <Clock size={16} />
        Лекция {formatTime(elapsed)} · слайд {formatTime(slideElapsed)}
      </div>
      <div className="join-panel">
        <span className="muted">Подключение</span>
        <strong>{session.joinCode}</strong>
        <small>/s/{session.joinCode}</small>
        <LocalQrCode value={joinUrl} label="QR кода лекции" />
      </div>
      <Tabs defaultValue="students" className="live-tabs">
        <TabsList className="live-tabs__list">
          <TabsTrigger value="students">Студенты</TabsTrigger>
          <TabsTrigger value="notes">Заметки</TabsTrigger>
          <TabsTrigger value="questions">Вопросы</TabsTrigger>
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
