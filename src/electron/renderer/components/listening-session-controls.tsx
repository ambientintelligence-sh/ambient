import {
  ArrowRightLeftIcon,
} from "lucide-react";
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

type ListeningSessionControlsProps = {
  languages: Language[];
  sourceLang: LanguageCode;
  targetLang: LanguageCode;
  translateToSelection: LanguageCode | "off";
  onSourceLangChange: (lang: LanguageCode) => void;
  onTargetLangChange: (lang: LanguageCode) => void;
  onTranslateToSelectionChange: (value: LanguageCode | "off") => void;
  onSetTranslationMode?: (direction: Direction | "off", targetLang?: LanguageCode) => void;
  armedMicInput: boolean;
  armedDeviceAudio: boolean;
  onToggleMicInput: () => void;
  onToggleDeviceAudio: () => void;
  onRecordToggle: () => void;
  uiState: UIState | null;
};

function getLanguageNative(lang: LanguageCode): string {
  return SUPPORTED_LANGUAGES.find((l) => l.code === lang)?.native ?? lang.toUpperCase();
}

function renderLanguageOption(lang: Language) {
  return (
    <span className="flex min-w-0 items-center gap-2">
      <span className="w-6 shrink-0 font-mono text-2xs text-muted-foreground/70">
        {lang.code.toUpperCase()}
      </span>
      <span className="truncate">{lang.name}</span>
      <span className="truncate text-muted-foreground">({lang.native})</span>
    </span>
  );
}

export function ListeningSessionControls({
  languages,
  sourceLang,
  targetLang,
  translateToSelection,
  onSourceLangChange,
  onTargetLangChange,
  onTranslateToSelectionChange,
  onSetTranslationMode,
  armedMicInput,
  armedDeviceAudio,
  onToggleMicInput,
  onToggleDeviceAudio,
  onRecordToggle,
  uiState,
}: ListeningSessionControlsProps) {
  const isDeviceAudioActive =
    uiState?.status === "recording" || uiState?.status === "connecting";
  const isMicActive = uiState?.micEnabled ?? false;
  const isCapturing = isDeviceAudioActive || isMicActive;
  const canTranslate = uiState?.canTranslate ?? false;
  const currentDirection: Direction = uiState?.direction ?? "auto";
  const languageOptions = languages.length > 0 ? languages : SUPPORTED_LANGUAGES;
  const availableTargetLanguages = SUPPORTED_LANGUAGES.filter((l) => l.code !== sourceLang);

  return (
    <section
      aria-label="Listening setup"
      className={[
        "rounded-2xl border px-3 py-2 shadow-sm transition-colors",
        isCapturing
          ? "border-red-500/20 bg-red-500/[0.035] dark:bg-red-500/[0.06]"
          : "border-border bg-muted/20",
      ].join(" ")}
    >
      <div className="flex flex-wrap items-center gap-2">
        <CaptureStatusPill
          active={isCapturing}
          status={isCapturing ? uiState?.status : "idle"}
          label="Ready to record"
          className="w-[128px] text-xs"
        />

        <div className="mx-1 h-4 w-px bg-border" />

        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
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
              className="h-7 w-auto min-w-12 border-0 bg-transparent px-2 text-2xs text-muted-foreground hover:bg-muted/60 hover:text-foreground"
              aria-label="Transcribe language"
              title={`Transcribe ${getLanguageNative(sourceLang)}`}
            >
              <SelectValue>{sourceLang.toUpperCase()}</SelectValue>
            </SelectTrigger>
            <SelectContent position="popper" align="start" sideOffset={4}>
              <SelectGroup>
                <SelectLabel>Transcribe from</SelectLabel>
                {languageOptions.map((lang) => (
                  <SelectItem key={lang.code} value={lang.code}>
                    {renderLanguageOption(lang)}
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
              className="h-7 w-auto min-w-12 border-0 bg-transparent px-2 text-2xs text-muted-foreground hover:bg-muted/60 hover:text-foreground"
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
                    {renderLanguageOption(lang)}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </div>

        <div className="mx-1 hidden h-4 w-px bg-border sm:block" />

        <div className="flex items-center gap-1">
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
        </div>

        <CaptureRecordButton
          active={isCapturing}
          status={uiState?.status}
          onClick={onRecordToggle}
          startTitle="Start recording"
          startLabel="Record"
          className="ml-auto rounded-md"
        />
      </div>
    </section>
  );
}
