import { useEffect } from "react";
import type { DarkVariant, FontFamily, FontSize, LightVariant, ThemeMode } from "@core/types";
import { applyThemeClass } from "../lib/theme";

export function useThemeMode(themeMode: ThemeMode, lightVariant: LightVariant = "warm", darkVariant: DarkVariant = "charcoal", fontSize: FontSize = "md", fontFamily: FontFamily = "sans") {
  useEffect(() => {
    const media =
      typeof globalThis.matchMedia === "function"
        ? globalThis.matchMedia("(prefers-color-scheme: dark)")
        : null;

    const applyTheme = () => {
      const shouldUseDark =
        themeMode === "dark" || (themeMode === "system" && !!media?.matches);
      applyThemeClass(shouldUseDark, lightVariant, darkVariant, fontSize, fontFamily);
    };

    applyTheme();
    if (themeMode !== "system" || !media) return;
    media.addEventListener("change", applyTheme);
    return () => media.removeEventListener("change", applyTheme);
  }, [themeMode, lightVariant, darkVariant, fontSize, fontFamily]);
}
