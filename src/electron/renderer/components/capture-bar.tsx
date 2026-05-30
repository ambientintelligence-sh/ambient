import { ArrowRightLeftIcon } from "lucide-react";
import type { Direction, Language, LanguageCode, UIState } from "@core/types";
import { SUPPORTED_LANGUAGES } from "@core/types";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CaptureRecordButton, CaptureStatusPill, CaptureToggleButton } from "./capture-controls";

type CaptureBarProps = {
  uiState: UIState | null;
  languages: Language[];
  sourceLang: LanguageCode;
  targetLang: LanguageCode;
  translateToSelection: LanguageCode | "off";
  armedMicInput: boolean;
  armedDeviceAudio: boolean;
  onSourceLangChange: (lang: LanguageCode) => void;
  onTargetLangChange: (lang: LanguageCode) => void;
  onTranslateToSelectionChange: (value: LanguageCode | "off") => void;
  onSetTranslationMode?: (direction: Direction | "off", targetLang?: LanguageCode) => void;
  onRecordToggle: () => void;
  onToggleMicInput: () => void;
  onToggleDeviceAudio: () => void;
};

function getLanguageNative(lang: LanguageCode): string {
  return SUPPORTED_LANGUAGES.find((l) => l.code === lang)?.native ?? lang.toUpperCase();
}

export function CaptureBar({
  uiState,
  languages,
  sourceLang,
  targetLang,
  translateToSelection,
  armedMicInput,
  armedDeviceAudio,
  onSourceLangChange,
  onTargetLangChange,
  onTranslateToSelectionChange,
  onSetTranslationMode,
  onRecordToggle,
  onToggleMicInput,
  onToggleDeviceAudio,
}: CaptureBarProps) {
  const isDeviceAudioActive =
    uiState?.status === "recording" || uiState?.status === "connecting";
  const isMicActive = uiState?.micEnabled ?? false;
  const isCapturing = isDeviceAudioActive || isMicActive;
  const canTranslate = uiState?.canTranslate ?? false;
  const currentDirection: Direction = uiState?.direction ?? "auto";

  const languageOptions = languages.length > 0 ? languages : SUPPORTED_LANGUAGES;
  const availableTargetLanguages = SUPPORTED_LANGUAGES.filter((l) => l.code !== sourceLang);

  return (
    <div
      className={[
        "relative flex items-center gap-0.5 border-b px-1.5 py-1.5 transition-colors",
        isCapturing
          ? "border-red-500/20 bg-red-500/[0.055] dark:border-red-400/20 dark:bg-red-400/[0.08]"
          : "border-sidebar-border/35",
      ].join(" ")}
    >
      {isCapturing && (
        <span className="pointer-events-none absolute inset-x-0 bottom-0 h-px bg-red-500/40 dark:bg-red-300/45" />
      )}
      <Select
        value={sourceLang}
        onValueChange={(v) => {
          onSourceLangChange(v as LanguageCode);
          if (translateToSelection !== "off" && v === targetLang) {
            const alt = v === "en" ? "ko" : "en";
            onTargetLangChange(alt as LanguageCode);
          }
        }}
        disabled={isDeviceAudioActive}
      >
        <SelectTrigger
          size="sm"
          className="h-7 border-0 bg-transparent px-1.5 text-2xs text-muted-foreground hover:bg-muted/60 hover:text-foreground"
          aria-label="Source language"
          title={`Transcribe ${getLanguageNative(sourceLang)}`}
        >
          <SelectValue>{sourceLang.toUpperCase()}</SelectValue>
        </SelectTrigger>
        <SelectContent position="popper" align="start" sideOffset={4}>
          <SelectGroup>
            <SelectLabel>Transcribe from</SelectLabel>
            {languageOptions.map((lang) => (
              <SelectItem key={lang.code} value={lang.code}>
                <span className="flex min-w-0 items-center gap-2">
                  <span className="w-6 shrink-0 font-mono text-2xs text-muted-foreground/70">
                    {lang.code.toUpperCase()}
                  </span>
                  <span className="truncate">{lang.name}</span>
                </span>
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>

      <ArrowRightLeftIcon className="size-3 shrink-0 text-muted-foreground/50" />

      <Select
        value={translateToSelection}
        onValueChange={(v) => {
          if (v === "off") {
            onTranslateToSelectionChange("off");
            onSetTranslationMode?.("off");
            return;
          }
          const nextTargetLang = v as LanguageCode;
          onTranslateToSelectionChange(nextTargetLang);
          onTargetLangChange(nextTargetLang);
          onSetTranslationMode?.(currentDirection, nextTargetLang);
        }}
        disabled={!canTranslate}
      >
        <SelectTrigger
          size="sm"
          className="h-7 border-0 bg-transparent px-1.5 text-2xs text-muted-foreground hover:bg-muted/60 hover:text-foreground"
          aria-label="Translation target"
          title={
            translateToSelection === "off"
              ? "Translation off"
              : `Translate to ${getLanguageNative(translateToSelection)}`
          }
        >
          <SelectValue>
            {translateToSelection === "off" ? "Off" : translateToSelection.toUpperCase()}
          </SelectValue>
        </SelectTrigger>
        <SelectContent position="popper" align="start" sideOffset={4}>
          <SelectItem value="off">Translation off</SelectItem>
          <SelectSeparator className="mx-2" />
          <SelectGroup>
            <SelectLabel>Translate to</SelectLabel>
            {availableTargetLanguages.map((lang) => (
              <SelectItem key={lang.code} value={lang.code}>
                <span className="flex min-w-0 items-center gap-2">
                  <span className="w-6 shrink-0 font-mono text-2xs text-muted-foreground/70">
                    {lang.code.toUpperCase()}
                  </span>
                  <span className="truncate">{lang.name}</span>
                </span>
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>

      <div className="flex-1" />

      <CaptureStatusPill
        active={isCapturing}
        status={uiState?.status}
        label="Ready"
        className={[
          "mr-1 rounded-full px-2 py-1 text-2xs",
          isCapturing
            ? "bg-red-500/10"
            : "hidden sm:inline-flex bg-foreground/[0.04]",
        ].join(" ")}
      />

      <CaptureToggleButton
        active={armedMicInput}
        kind="mic"
        onClick={onToggleMicInput}
      />

      <CaptureToggleButton
        active={armedDeviceAudio}
        kind="device-audio"
        onClick={onToggleDeviceAudio}
      />

      <CaptureRecordButton
        active={isCapturing}
        status={uiState?.status}
        onClick={onRecordToggle}
        startTitle="Start recording"
        className="ml-1"
      />
    </div>
  );
}
