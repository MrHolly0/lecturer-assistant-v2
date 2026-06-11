import { useQuery } from "@tanstack/react-query";
import { getSystemInfo } from "./api/client";

const modules = [
  "iam",
  "org",
  "content",
  "live",
  "qa",
  "feedback",
  "interaction",
  "channel",
  "analytics",
  "shared"
];

export function App() {
  const systemInfo = useQuery({
    queryKey: ["system-info"],
    queryFn: getSystemInfo
  });

  const status = systemInfo.data?.status ?? (systemInfo.isError ? "OFFLINE" : "CHECKING");

  return (
    <main className="shell">
      <section className="hero" aria-labelledby="page-title">
        <div>
          <p className="eyebrow">Phase 0 scaffold</p>
          <h1 id="page-title">Lecturer Assistant v2</h1>
          <p className="lead">
            Modular core, channel adapters, and web workspace are connected from the first
            checkpoint.
          </p>
        </div>
        <div className={`status-pill status-pill--${status.toLowerCase()}`}>
          <span aria-hidden="true" />
          {status}
        </div>
      </section>

      <section className="grid" aria-label="Bootstrap status">
        <article className="panel panel--wide">
          <p className="label">Core API</p>
          <h2>{systemInfo.data?.name ?? "lecturer-assistant-v2"}</h2>
          <dl className="facts">
            <div>
              <dt>Version</dt>
              <dd>{systemInfo.data?.version ?? "waiting for core"}</dd>
            </div>
            <div>
              <dt>Contract</dt>
              <dd>OpenAPI v1</dd>
            </div>
          </dl>
        </article>

        <article className="panel">
          <p className="label">Database</p>
          <h2>PostgreSQL + Flyway</h2>
          <p>Schema-per-module baseline is applied by V1.</p>
        </article>

        <article className="panel">
          <p className="label">Architecture</p>
          <h2>ArchUnit guarded</h2>
          <p>Internal packages and channel SDK imports are checked on every build.</p>
        </article>
      </section>

      <section className="module-strip" aria-label="Core modules">
        {modules.map((module) => (
          <span key={module}>{module}</span>
        ))}
      </section>
    </main>
  );
}
