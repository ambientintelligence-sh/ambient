import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app";
import { PopupApp } from "./popup-app";
import { ErrorBoundary } from "./components/error-boundary";
import { applyThemeClass, readStoredThemeMode, resolveShouldUseDark } from "./lib/theme";
import { installRendererErrorHooks } from "./lib/renderer-log";
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

const tag = isPopupRoute() ? "popup" : "main";
installRendererErrorHooks(tag);

const root = document.getElementById("root");
if (root) {
  createRoot(root).render(
    <StrictMode>
      <ErrorBoundary tag={tag}>
        {isPopupRoute()
          ? <PopupApp initialSessionId={parsePopupSessionId()} />
          : <App />}
      </ErrorBoundary>
    </StrictMode>
  );
}
