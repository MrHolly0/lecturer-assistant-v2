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
import type { MaxColorScheme } from "./types";

const THEME_KEY = "la_theme_preference";

function readPreferredTheme(): MaxColorScheme | null {
  try {
    const value = localStorage.getItem(THEME_KEY);
    return value === "light" || value === "dark" ? value : null;
  } catch {
    return null;
  }
}

export function MaxBridgeProvider({ children }: { children: ReactNode }) {
  const [environment, setEnvironment] = useState(readEnvironment);
  const [preferredTheme, setPreferredThemeState] = useState(readPreferredTheme);
  const theme = preferredTheme ?? environment.theme;

  const setPreferredTheme = useCallback((next: MaxColorScheme | null) => {
    setPreferredThemeState(next);
    try {
      if (next) localStorage.setItem(THEME_KEY, next);
      else localStorage.removeItem(THEME_KEY);
    } catch {
      // The choice still applies until this WebView closes.
    }
  }, []);

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
    root.dataset.appTheme = theme;
    root.style.colorScheme = theme;
    root.style.setProperty("--app-viewport-height", `${environment.viewport.height}px`);
    root.style.setProperty("--app-viewport-width", `${environment.viewport.width}px`);
    root.classList.toggle("dark", theme === "dark");

    return () => {
      root.classList.remove("dark");
      delete root.dataset.maxMiniApp;
      delete root.dataset.appPlatform;
      delete root.dataset.appTheme;
      root.style.removeProperty("color-scheme");
      root.style.removeProperty("--app-viewport-height");
      root.style.removeProperty("--app-viewport-width");
    };
  }, [environment, theme]);

  const value = useMemo(
    () => ({ ...environment, theme, refreshViewport, preferredTheme, setPreferredTheme }),
    [environment, theme, refreshViewport, preferredTheme, setPreferredTheme]
  );

  return <MaxBridgeContext.Provider value={value}>{children}</MaxBridgeContext.Provider>;
}
