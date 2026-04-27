import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app";
import { PopupApp } from "./popup-app";
import { applyThemeClass, readStoredThemeMode, resolveShouldUseDark } from "./lib/theme";
import "./styles/global.css";

applyThemeClass(resolveShouldUseDark(readStoredThemeMode()));

function isPopupRoute(): boolean {
  return window.location.hash.startsWith("#popup");
}

function parsePopupSessionId(): string | null {
  const hash = window.location.hash;
  const queryStart = hash.indexOf("?");
  if (queryStart < 0) return null;
  const params = new URLSearchParams(hash.slice(queryStart + 1));
  return params.get("sessionId");
}

const root = document.getElementById("root");
if (root) {
  createRoot(root).render(
    <StrictMode>
      {isPopupRoute()
        ? <PopupApp initialSessionId={parsePopupSessionId()} />
        : <App />}
    </StrictMode>
  );
}
