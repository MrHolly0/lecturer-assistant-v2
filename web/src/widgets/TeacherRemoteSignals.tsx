import type { StudentEngagement } from "../app/api/student-api";
import { pluralizeRu } from "../shared/lib/plural";

export function TeacherRemoteSignals({ engagement }: { engagement?: StudentEngagement }) {
  const signals = engagement?.signalAggregate;
  const total = signals?.total ?? 0;
  return (
    <section className="teacher-remote-section" aria-labelledby="remote-signals-title">
      <div className="teacher-remote-section__heading">
        <h2 id="remote-signals-title">Понимание</h2>
        <span>
          {total} {pluralizeRu(total, "сигнал", "сигнала", "сигналов")}
        </span>
      </div>
      <div className="teacher-remote-signals">
        <Signal label="Понятно" value={signals?.green ?? 0} tone="green" />
        <Signal label="Есть вопрос" value={signals?.yellow ?? 0} tone="yellow" />
        <Signal label="Не понимаю" value={signals?.red ?? 0} tone="red" />
      </div>
    </section>
  );
}

function Signal({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div className={`teacher-remote-signal teacher-remote-signal--${tone}`}>
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  );
}
