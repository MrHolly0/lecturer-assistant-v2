import { useEffect, useRef, useState, type ReactNode } from "react";
import { Maximize, Monitor } from "lucide-react";
import { useSearchParams } from "react-router-dom";
import { Button } from "../../shared/ui/button";
import { BrandMark } from "../../shared/brand/BrandMark";
import { displayId, isProjectionMessage, type ProjectionMessage } from "./setupState";
import type { ProjectionWindow, ScreenDetails } from "./browserProjection";

/** Public projection must stay neutral until its opener confirms this exact physical test. */
export function ProjectionSetupGate({ children }: { children: ReactNode }) {
  const [query] = useSearchParams();
  const hasAttempt = query.has("attempt");
  const attemptId = query.get("attempt");
  const testCode = query.get("testCode") ?? "";
  const [showMaterial, setShowMaterial] = useState(false);
  const [fullscreenError, setFullscreenError] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const detailsRef = useRef<ScreenDetails | null>(null);
  const leaseRef = useRef(0);
  const validAttempt =
    !!attemptId && /^[a-f0-9-]{36}$/i.test(attemptId) && /^\d{4}$/.test(testCode);

  useEffect(() => {
    if (!validAttempt || !attemptId) return;
    const opener = window.opener;
    if (!opener) return;
    let disposed = false;
    let details: ScreenDetails | null = null;
    const send = (message: Omit<ProjectionMessage, "attemptId" | "protocol">) => {
      if (!opener.closed)
        opener.postMessage(
          { ...message, protocol: "la-projector-v1", attemptId },
          window.location.origin
        );
    };
    const position = () => {
      setIsFullscreen(!!document.fullscreenElement);
      send({
        type: "position",
        screenId: details ? displayId(details.currentScreen) : "",
        fullscreen: !!document.fullscreenElement
      });
    };
    const receive = (event: MessageEvent) => {
      if (
        event.source !== opener ||
        event.origin !== window.location.origin ||
        !isProjectionMessage(event.data, attemptId)
      )
        return;
      if (event.data.type === "neutral") {
        leaseRef.current = 0;
        setShowMaterial(false);
      } else if (event.data.type === "show") {
        leaseRef.current = Date.now();
        setShowMaterial(true);
      } else if (event.data.type === "lease" && leaseRef.current > 0) {
        leaseRef.current = Date.now();
      }
    };
    window.addEventListener("message", receive);
    document.addEventListener("fullscreenchange", position);
    send({ type: "hello" });
    const readScreen = async () => {
      try {
        const host = window as ProjectionWindow;
        if (!host.getScreenDetails) {
          position();
          return;
        }
        const result = await host.getScreenDetails();
        if (disposed) return;
        details = result;
        detailsRef.current = result;
        details.addEventListener("currentscreenchange", position);
        details.addEventListener("screenschange", position);
        position();
      } catch {
        position();
      }
    };
    void readScreen();
    const timer = setInterval(() => {
      position();
      if (opener.closed || (leaseRef.current > 0 && Date.now() - leaseRef.current > 6000)) {
        leaseRef.current = 0;
        setShowMaterial(false);
      }
    }, 1000);
    return () => {
      disposed = true;
      clearInterval(timer);
      window.removeEventListener("message", receive);
      document.removeEventListener("fullscreenchange", position);
      details?.removeEventListener("currentscreenchange", position);
      details?.removeEventListener("screenschange", position);
      detailsRef.current = null;
    };
  }, [attemptId, validAttempt]);

  if (!hasAttempt) return <>{children}</>;
  if (showMaterial) return <>{children}</>;
  const fullscreen = async () => {
    try {
      const screen = detailsRef.current?.currentScreen;
      await document.documentElement.requestFullscreen({
        navigationUI: "hide",
        ...(screen ? { screen } : {})
      } as FullscreenOptions);
      setFullscreenError(false);
    } catch {
      setFullscreenError(true);
    }
  };
  return (
    <main className="projector-public-test">
      <div className="projector-public-test__brand">
        <BrandMark />
        <span>Lecturer Assistant</span>
      </div>
      <Monitor size={48} aria-hidden="true" />
      <p className="projector-eyebrow">ПРОВЕРКА ПРОЕКТОРА</p>
      <h1>{validAttempt ? "Вы видите этот код?" : "Откройте проверку из настройки проектора"}</h1>
      {validAttempt && <p className="projector-public-test__code">{testCode}</p>}
      <p>Подтвердите код в окне настройки на рабочем экране преподавателя.</p>
      <p className="projector-muted">Учебный материал появится после подтверждения.</p>
      {!isFullscreen && (
        <Button variant="outline" onClick={() => void fullscreen()}>
          <Maximize size={18} />
          На весь экран
        </Button>
      )}
      {fullscreenError && (
        <p role="status">Полный экран не включён. Проверку можно продолжить в этом окне.</p>
      )}
    </main>
  );
}
