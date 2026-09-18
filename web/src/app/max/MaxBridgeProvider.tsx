import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  getMaxWebApp,
  isMaxLaunch,
  notifyReady,
  readEnvironment,
  readTheme,
  readViewport
} from "./bridge";
import { MaxBridgeContext } from "./context";

export function MaxBridgeProvider({ children }: { children: ReactNode }) {
  const [environment, setEnvironment] = useState(readEnvironment);

  const refreshViewport = useCallback(async () => {
    const viewport = await readViewport();
    setEnvironment((current) =>
      current.viewport.height === viewport.height && current.viewport.width === viewport.width
        ? current
        : { ...current, viewport }
    );
  }, []);

  useEffect(() => {
    notifyReady();
    void refreshViewport();

    const visualViewport = window.visualViewport;
    window.addEventListener("resize", refreshViewport);
    visualViewport?.addEventListener("resize", refreshViewport);

    return () => {
      window.removeEventListener("resize", refreshViewport);
      visualViewport?.removeEventListener("resize", refreshViewport);
    };
  }, [refreshViewport]);

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const webApp = getMaxWebApp();
    const updateTheme = () => {
      const theme = readTheme(isMaxLaunch(webApp) ? webApp : null);
      setEnvironment((current) => (current.theme === theme ? current : { ...current, theme }));
    };

    media.addEventListener("change", updateTheme);
    webApp?.onEvent?.("themeChanged", updateTheme);

    return () => {
      media.removeEventListener("change", updateTheme);
      webApp?.offEvent?.("themeChanged", updateTheme);
    };
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    root.dataset.maxMiniApp = String(environment.isMax);
    root.dataset.appPlatform = environment.platform;
    root.dataset.appTheme = environment.theme;
    root.style.setProperty("--app-viewport-height", `${environment.viewport.height}px`);
    root.style.setProperty("--app-viewport-width", `${environment.viewport.width}px`);
    root.classList.toggle("dark", environment.isMax && environment.theme === "dark");

    return () => {
      root.classList.remove("dark");
      delete root.dataset.maxMiniApp;
      delete root.dataset.appPlatform;
      delete root.dataset.appTheme;
      root.style.removeProperty("--app-viewport-height");
      root.style.removeProperty("--app-viewport-width");
    };
  }, [environment]);

  const value = useMemo(
    () => ({ ...environment, refreshViewport }),
    [environment, refreshViewport]
  );

  return <MaxBridgeContext.Provider value={value}>{children}</MaxBridgeContext.Provider>;
}
