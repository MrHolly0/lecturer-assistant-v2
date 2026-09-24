import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getDeck, slideImageUrl } from "../app/api/content-api";
import { connectLiveSession, getLiveSession, type LiveSession } from "../app/api/live-api";
import { DrawingOverlay, type LiveAnnotations } from "../widgets/DrawingOverlay";
import { LocalQrCode } from "../widgets/LocalQrCode";
import { buildMaxJoinUrl } from "../app/max/deepLink";
import { BrandMark } from "../shared/brand/BrandMark";

export function ProjectionPage({ courseId, sessionId }: { courseId: string; sessionId: string }) {
  const [localSession, setLocalSession] = useState<LiveSession | null>(null);
  const sessionQuery = useQuery({
    queryKey: ["live", courseId, sessionId],
    queryFn: () => getLiveSession(courseId, sessionId)
  });
  const session = localSession ?? sessionQuery.data;
  const liveSessionId = session?.id;
  const deckQuery = useQuery({
    queryKey: ["content", courseId, "decks", session?.deckId],
    queryFn: () => getDeck(courseId, session?.deckId ?? ""),
    enabled: Boolean(session?.deckId)
  });
  const deck = deckQuery.data;
  const slide =
    deck?.slides.find((item) => item.idx === session?.currentSlideIdx) ?? deck?.slides[0];
  const showJoinCode = slide?.idx === 1;
  const joinUrl = useMemo(() => buildMaxJoinUrl(session?.joinCode ?? ""), [session?.joinCode]);

  useEffect(() => {
    if (sessionQuery.data) setLocalSession(sessionQuery.data);
  }, [sessionQuery.data]);

  useEffect(() => {
    if (!liveSessionId) return;
    const channel = new BroadcastChannel(`session-${liveSessionId}`);
    channel.onmessage = (event) => setLocalSession(event.data as LiveSession);
    const disconnect = connectLiveSession(liveSessionId, (message) =>
      setLocalSession(message.session)
    );
    return () => {
      disconnect();
      channel.close();
    };
  }, [liveSessionId]);

  if (!session || !deck || !slide) {
    return <div className="projection-shell">Загрузка...</div>;
  }

  return (
    <main className="projection-shell">
      <img src={slideImageUrl(slide)} alt={`Слайд ${slide.idx}`} />
      <DrawingOverlay
        slideIdx={slide.idx}
        annotations={session.annotations as LiveAnnotations}
        active={false}
        onChange={() => undefined}
      />
      {showJoinCode && (
        <div className="projection-code">
          <span>Код подключения</span>
          <strong>{session.joinCode}</strong>
          {joinUrl ? (
            <div className="projection-qr-lockup">
              <div className="projection-brand">
                <BrandMark />
                <span>Lecturer Assistant</span>
              </div>
              <LocalQrCode value={joinUrl} label="Открыть лекцию в MAX" />
            </div>
          ) : (
            <small>MAX-бот не настроен</small>
          )}
        </div>
      )}
    </main>
  );
}
