import { ArrowRight, Radio } from "lucide-react";
import { Link } from "react-router-dom";
import type { ActiveSession } from "../app/api/live-api";

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
      <Link
        className="btn-primary"
        to={`/courses/${session.courseId}/sessions/${session.sessionId}/presenter`}
      >
        Продолжить
        <ArrowRight size={16} />
      </Link>
    </section>
  );
}
