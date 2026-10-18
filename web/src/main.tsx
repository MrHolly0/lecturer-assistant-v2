import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { App } from "./app/App";
import { MaxBridgeProvider } from "./app/max/MaxBridgeProvider";
import { queryClient } from "./app/queryClient";
import { registerServiceWorker } from "./app/offline";
import "./styles.css";
import "./styles/non-live-workflows.css";
import "./styles/course-workflows.css";
import "./styles/live-experience.css";
import "./styles/redesign-base.css";
import "./styles/redesign-catalog.css";
import "./styles/redesign-preparation.css";
import "./styles/redesign-live.css";
import "./styles/presenter-workspace.css";
import "./styles/presenter-interactions.css";
import "./styles/presenter-tools.css";
import "./styles/student-experience.css";
import "./styles/student-question-dialog.css";
import "./styles/redesign-admin.css";
import "./styles/redesign-auth.css";

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
