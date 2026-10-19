import { useEffect } from "react";
import { useAuth } from "../AuthContext";
import { browserProjection } from "../projection/browserProjection";
import { screenShare } from "./screenShare";

/** Expired staff auth must not leave a leased public display or capture behind. */
export function ProjectionLifecycle() {
  const { user, loading } = useAuth();
  useEffect(() => {
    if (!loading && (!user || user.role === "STUDENT")) {
      browserProjection.stop();
      void screenShare.stop();
    }
  }, [user, loading]);
  useEffect(() => {
    const unsubscribe = browserProjection.subscribe(() => {
      if (
        browserProjection.getSnapshot().phase === "stopped" &&
        screenShare.getSnapshot().phase !== "idle"
      )
        void screenShare.stop();
    });
    return () => {
      unsubscribe();
    };
  }, []);
  return null;
}
