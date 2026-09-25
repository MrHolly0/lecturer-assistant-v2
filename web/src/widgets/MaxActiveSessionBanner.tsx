import { Radio, Square } from "lucide-react";
import type { ActiveSession } from "../app/api/live-api";
import { LinkButton } from "../shared/ui/button";
import { ConfirmActionButton } from "./ConfirmActionButton";

export function MaxActiveSessionBanner({
  session,
  ending,
  onEnd
}: {
  session: ActiveSession;
  ending: boolean;
  onEnd: () => void;
}) {
  return (
    <section className="max-active-session" aria-labelledby="active-session-title">
      <div className="max-active-session__icon" aria-hidden="true">
        <Radio size={20} />
      </div>
      <div>
        <span className="max-active-session__eyebrow">Лекция идёт</span>
        <h2 id="active-session-title">{session.lectureTitle}</h2>
        <p className="muted">Сейчас показывается слайд {session.currentSlideIdx}</p>
      </div>
      <div className="max-active-session__actions">
        <LinkButton to={`/courses/${session.courseId}/sessions/${session.sessionId}/presenter`}>
          Продолжить
        </LinkButton>
        <ConfirmActionButton
          title="Завершить текущую лекцию?"
          description="Сигналы и ответы перестанут приниматься. После завершения будет доступен итог занятия."
          confirmLabel="Завершить"
          variant="outline"
          disabled={ending}
          onConfirm={onEnd}
        >
          <Square size={15} aria-hidden="true" />
          Завершить
        </ConfirmActionButton>
      </div>
    </section>
  );
}
