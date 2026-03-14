import type { DarkVariant, FontFamily, FontSize, LightVariant, ThemeMode } from "@core/types";

const FONT_SIZE_BASE: Record<FontSize, number> = {
  sm: 14,
  md: 16,
  lg: 18,
};

const FONT_SIZE_BOOST: Record<FontFamily, number> = {
  sans: 0,
  serif: 1,
  mono: 0,
};

const FONT_FAMILY_STACK: Record<FontFamily, string> = {
  sans: '"Inter Variable", "Inter", system-ui, sans-serif',
  serif: '"Lora Variable", "Lora", Georgia, serif',
  mono: '"JetBrains Mono Variable", "JetBrains Mono", monospace',
};

const APP_CONFIG_STORAGE_KEY = "ambient-app-config";
const LIGHT_BACKGROUND_BY_VARIANT: Record<LightVariant, string> = {
  warm: "oklch(0.985 0.002 90)",
  linen: "oklch(0.939 0 0)",
  ivory: "oklch(0.968 0.004 90)",
  petal: "oklch(0.938 0.008 192)",
};

const DARK_BACKGROUND_BY_VARIANT: Record<DarkVariant, string> = {
  charcoal: "oklch(0.145 0 0)",
  steel: "oklch(0.2 0.004 260)",
  abyss: "oklch(0.185 0.02 264)",
  "pitch-black": "oklch(0 0 0)",
};

const LIGHT_VARIANT_CLASSES = [
  { variant: "linen", className: "light-linen" },
  { variant: "ivory", className: "light-ivory" },
  { variant: "petal", className: "light-petal" },
] as const;

const DARK_VARIANT_CLASSES = [
  { variant: "steel", className: "dark-steel" },
  { variant: "abyss", className: "dark-abyss" },
  { variant: "pitch-black", className: "dark-pitch-black" },
] as const;

function isThemeMode(value: unknown): value is ThemeMode {
  return value === "light" || value === "dark" || value === "system";
}

export function readStoredThemeMode(): ThemeMode | undefined {
  try {
    const raw = globalThis.localStorage.getItem(APP_CONFIG_STORAGE_KEY);
    if (!raw) return undefined;
    const parsed = JSON.parse(raw) as { themeMode?: unknown };
    return isThemeMode(parsed.themeMode) ? parsed.themeMode : undefined;
  } catch {
    return undefined;
  }
}

export function resolveShouldUseDark(themeMode: ThemeMode | undefined): boolean {
  const prefersDark =
    typeof globalThis.matchMedia === "function" &&
    globalThis.matchMedia("(prefers-color-scheme: dark)").matches;
  return themeMode === "dark" || (themeMode !== "light" && prefersDark);
}

function applyVariantClasses(
  target: HTMLElement,
  shouldUseDark: boolean,
  lightVariant: LightVariant,
  darkVariant: DarkVariant
): void {
  target.classList.toggle("dark", shouldUseDark);
  for (const item of LIGHT_VARIANT_CLASSES) {
    target.classList.toggle(
      item.className,
      !shouldUseDark && lightVariant === item.variant
    );
  }
  for (const item of DARK_VARIANT_CLASSES) {
    target.classList.toggle(
      item.className,
      shouldUseDark && darkVariant === item.variant
    );
  }
}

export function applyThemeClass(shouldUseDark: boolean, lightVariant: LightVariant = "warm", darkVariant: DarkVariant = "charcoal", fontSize: FontSize = "md", fontFamily: FontFamily = "sans") {
  const root = globalThis.document.documentElement;
  applyVariantClasses(root, shouldUseDark, lightVariant, darkVariant);
  root.style.colorScheme = shouldUseDark ? "dark" : "light";
  root.style.backgroundColor = shouldUseDark
    ? DARK_BACKGROUND_BY_VARIANT[darkVariant]
    : LIGHT_BACKGROUND_BY_VARIANT[lightVariant];
  root.style.fontSize = `${FONT_SIZE_BASE[fontSize] + FONT_SIZE_BOOST[fontFamily]}px`;
  root.style.setProperty("--font-sans", FONT_FAMILY_STACK[fontFamily]);

  const body = globalThis.document.body;
  if (body) {
    applyVariantClasses(body, shouldUseDark, lightVariant, darkVariant);
  }
}
