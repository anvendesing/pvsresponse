import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { registerSW } from "virtual:pwa-register";
import { App } from "./App";
import "./styles/theme.css";
import "./styles/mobile.css";
import { setStatusBarGreen, hideSplash } from "./lib/native";

const container = document.getElementById("root");
if (!container) {
  throw new Error("Root container #root not found in index.html");
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>
);

// Native app: configure status bar and hide splash after React renders.
void setStatusBarGreen();
void hideSplash();

// Register PWA service worker with a prompt-based update flow.
// When a new SW is waiting we show a toast; the user taps "Update" to reload.
if (import.meta.env.PROD) {
  const updateSW = registerSW({
    onNeedRefresh() {
      window.dispatchEvent(new CustomEvent("sw-update-available", { detail: { updateSW } }));
    },
    onOfflineReady() {
      window.dispatchEvent(new CustomEvent("sw-offline-ready"));
    },
  });
}
