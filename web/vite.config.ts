import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const coreTarget = process.env.LA_CORE_PROXY_TARGET ?? "http://localhost:8080";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: coreTarget,
        changeOrigin: true
      },
      "/ws": {
        target: coreTarget.replace(/^http/, "ws"),
        ws: true,
        changeOrigin: true
      }
    }
  }
});
