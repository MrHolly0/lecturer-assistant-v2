import { Clock } from "lucide-react";
import type { Slide } from "../app/api/content-api";
import type { LiveSession, SessionParticipant } from "../app/api/live-api";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../shared/ui/tabs";
import { LocalQrCode } from "./LocalQrCode";

interface PresenterSidePanelProps {
  session: LiveSession;
  slide: Slide;
  participants: SessionParticipant[];
  elapsed: number;
  slideElapsed: number;
}

export function PresenterSidePanel({
  session,
  slide,
  participants,
  elapsed,
  slideElapsed
}: PresenterSidePanelProps) {
  const activeParticipants = participants.filter((participant) => !participant.leftAt);

  return (
    <aside className="presenter-side">
      <div className="live-metric">
        <Clock size={16} />
        Лекция {formatTime(elapsed)} · слайд {formatTime(slideElapsed)}
      </div>
      <div className="join-panel">
        <span className="muted">Подключение</span>
        <strong>{session.joinCode}</strong>
        <small>/join {session.joinCode}</small>
        <LocalQrCode value={session.joinCode} label="QR кода лекции" />
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
            <span className="badge badge--muted">задел</span>
          </div>
          <p className="muted">Очередь вопросов появится в следующем модуле.</p>
        </TabsContent>
      </Tabs>
    </aside>
  );
}

function formatTime(total: number) {
  const minutes = Math.floor(total / 60)
    .toString()
    .padStart(2, "0");
  const seconds = (total % 60).toString().padStart(2, "0");
  return `${minutes}:${seconds}`;
}
