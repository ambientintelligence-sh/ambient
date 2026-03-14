import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app";
import { applyThemeClass, readStoredThemeMode, resolveShouldUseDark } from "./lib/theme";
import "./styles/global.css";

applyThemeClass(resolveShouldUseDark(readStoredThemeMode()));

const root = document.getElementById("root");
if (root) {
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>
  );
}
