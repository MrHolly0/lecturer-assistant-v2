import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { App } from "./app/App";
import { MaxBridgeProvider } from "./app/max/MaxBridgeProvider";
import { queryClient } from "./app/queryClient";
import { registerServiceWorker } from "./app/offline";
import "./styles.css";

registerServiceWorker();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <MaxBridgeProvider>
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>
    </MaxBridgeProvider>
  </React.StrictMode>
);
