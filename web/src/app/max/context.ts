import { createContext, useContext } from "react";
import type { MaxEnvironment } from "./bridge";

export interface MaxBridgeContextValue extends MaxEnvironment {
  refreshViewport: () => Promise<void>;
}

export const MaxBridgeContext = createContext<MaxBridgeContextValue | null>(null);

export function useMaxBridge(): MaxBridgeContextValue {
  const context = useContext(MaxBridgeContext);
  if (!context) throw new Error("useMaxBridge must be used within MaxBridgeProvider");
  return context;
}
