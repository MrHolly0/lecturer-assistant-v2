import { Radio } from "lucide-react";
import type { ActiveSession } from "../app/api/live-api";
import { LinkButton } from "../shared/ui/button";

export function MaxActiveSessionBanner({ session }: { session: ActiveSession }) {
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
      <LinkButton
        to={`/courses/${session.courseId}/sessions/${session.sessionId}/presenter`}
      >
        Продолжить
      </LinkButton>
    </section>
  );
}
