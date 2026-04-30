import { ArrowLeftIcon, ArrowRightLeftIcon, CircleIcon, MicIcon, MicOffIcon, PanelRightOpenIcon, Settings2Icon, SquareIcon, Volume2Icon, VolumeXIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
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
import type { Direction, Language, LanguageCode, UIState } from "@core/types";
import { SUPPORTED_LANGUAGES } from "@core/types";

type ToolbarHeaderProps = {
  languages: Language[];
  sourceLang: LanguageCode;
  targetLang: LanguageCode;
  translateToSelection: LanguageCode | "off";
  onSourceLangChange: (lang: LanguageCode) => void;
  onTargetLangChange: (lang: LanguageCode) => void;
  onTranslateToSelectionChange: (value: LanguageCode | "off") => void;
  sessionActive: boolean;
  armedMicInput: boolean;
  armedDeviceAudio: boolean;
  onToggleMicInput: () => void;
  onToggleDeviceAudio: () => void;
  onRecordToggle: () => void;
  uiState: UIState | null;
  langError: string;
  onToggleTranslation?: () => void;
  onSetTranslationMode?: (direction: Direction | "off", targetLang?: LanguageCode) => void;
  settingsOpen?: boolean;
  onToggleSettings?: () => void;
  onPopOut?: () => void;
  popupOpen?: boolean;
};

function StatusBadge({ status }: { status: UIState["status"] }) {
  if (status === "recording" || status === "connecting") {
    return (
      <Badge className="w-[112px] justify-center gap-1.5 rounded-full bg-red-50 px-2.5 font-normal text-red-700 hover:bg-red-50 dark:bg-red-500/10 dark:text-red-300 dark:hover:bg-red-500/10">
        <span className="relative flex size-2">
          <span className="absolute inset-0 rounded-full bg-red-500/35 animate-ping" />
          <span className="relative inline-flex size-2 rounded-full bg-red-500" />
        </span>
        <span className="animate-pulse">
          {status === "connecting" ? "Connecting..." : "Recording"}
        </span>
      </Badge>
    );
  }

  return (
    <Badge variant="secondary" className="w-[112px] justify-center gap-1.5 rounded-full px-2.5 font-normal">
      <span className="inline-block w-2 h-2 rounded-full bg-muted-foreground/40" />
      Idle
    </Badge>
  );
}

function renderLabel(languages: Language[], code: LanguageCode) {
  const lang = languages.find((l) => l.code === code);
  return lang ? lang.native : code.toUpperCase();
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

function getTranslateDisplayLabel(lang: LanguageCode): string {
  const l = SUPPORTED_LANGUAGES.find((x) => x.code === lang);
  return l?.native ?? lang.toUpperCase();
}

export function ToolbarHeader({
  languages,
  sourceLang,
  targetLang,
  translateToSelection,
  onSourceLangChange,
  onTargetLangChange,
  onTranslateToSelectionChange,
  sessionActive,
  armedMicInput,
  armedDeviceAudio,
  onToggleMicInput,
  onToggleDeviceAudio,
  onRecordToggle,
  uiState,
  langError,
  onToggleTranslation: _onToggleTranslation,
  onSetTranslationMode,
  settingsOpen,
  onToggleSettings,
  onPopOut,
  popupOpen = false,
}: ToolbarHeaderProps) {
  const isDeviceAudioActive =
    uiState?.status === "recording" || uiState?.status === "connecting";
  const isMicActive = uiState?.micEnabled ?? false;
  const isCapturing = isDeviceAudioActive || isMicActive;
  const loading = languages.length === 0;
  const canTranslate = uiState?.canTranslate ?? false;
  const translationEnabled = (uiState?.translationEnabled ?? false) && canTranslate;
  const currentDirection: Direction = uiState?.direction ?? "auto";
  const logoUrl = new URL("../../../../assets/ambient-eclipse-filled.svg", import.meta.url).href;
  const statusForBadge: UIState["status"] =
    isCapturing
      ? (uiState?.status === "connecting" ? "connecting" : "recording")
      : "idle";

  const translateValue = translateToSelection;

  const languageOptions = languages.length > 0 ? languages : SUPPORTED_LANGUAGES;
  const availableTargetLanguages = SUPPORTED_LANGUAGES.filter((l) => l.code !== sourceLang);

  if (settingsOpen) {
    return (
      <div className="shrink-0">
        <div
          className="titlebar-drag border-b border-border pl-20 pr-4 flex items-center h-11 relative"
          data-window-title="Settings"
        >
          <Button variant="ghost" size="sm" onClick={onToggleSettings} className="titlebar-no-drag gap-1.5">
            <ArrowLeftIcon className="size-3.5" />
            Back
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="shrink-0">
      <div
        className="titlebar-drag border-b border-border pl-20 pr-3 flex min-w-0 items-center gap-2 h-11 text-sm relative"
        data-window-title="Ambient"
      >
        {/* Logo */}
        <div className="titlebar-no-drag flex shrink-0 items-center gap-0.5">
          <img
            src={logoUrl}
            alt="Ambient logo"
            className="h-[1.15em] w-auto"
            draggable={false}
          />
          <span className="font-sans text-sm font-semibold text-foreground tracking-tight">
            Ambient
          </span>
        </div>

        <Separator orientation="vertical" className="h-4" />

        {/* Language controls */}
        <div className="flex min-w-0 items-center gap-2 titlebar-no-drag">
          <span className="shrink-0 text-xs text-muted-foreground">Translate</span>
          <Select
            value={sourceLang}
            onValueChange={(v) => {
              onSourceLangChange(v as LanguageCode);
              if (translateToSelection !== "off" && v === targetLang) {
                const alt = v === "en" ? "ko" : "en";
                onTargetLangChange(alt as LanguageCode);
              }
            }}
            disabled={loading || isDeviceAudioActive}
          >
            <SelectTrigger size="sm" className="w-36">
              <SelectValue>
                {loading ? "..." : renderLabel(languages, sourceLang)}
              </SelectValue>
            </SelectTrigger>
            <SelectContent position="popper" align="start" sideOffset={4}>
              <SelectGroup>
                <SelectLabel>Translate from</SelectLabel>
                {languageOptions.map((lang) => (
                  <SelectItem key={lang.code} value={lang.code}>
                    {renderLanguageOption(lang)}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
          <ArrowRightLeftIcon className="size-3.5 shrink-0 text-muted-foreground/70" />
          <Select
            value={translateValue}
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
            disabled={loading || !sessionActive || !canTranslate}
          >
            <SelectTrigger
              size="sm"
              className={`w-40 ${translationEnabled ? "border-primary/40" : ""}`}
            >
              <SelectValue>
                {translateToSelection === "off" ? "Translation off" : getTranslateDisplayLabel(translateToSelection)}
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

        <Separator orientation="vertical" className="h-4" />

        {/* Recording controls */}
        <div className="flex shrink-0 items-center gap-1.5 titlebar-no-drag">
          <Button
            variant="ghost"
            size="sm"
            onClick={onToggleMicInput}
            className={armedMicInput
              ? "gap-1.5 px-2 bg-muted text-foreground"
              : "gap-1.5 px-2 text-muted-foreground"}
            aria-pressed={armedMicInput}
            aria-label={armedMicInput ? "Disable mic input" : "Enable mic input"}
          >
            <span className={`flex size-3.5 items-center justify-center rounded-[4px] border ${armedMicInput ? "border-primary/60 bg-primary/8" : "border-muted-foreground/40 bg-transparent"}`}>
              <span className={`size-1.5 rounded-[2px] ${armedMicInput ? "bg-primary" : "bg-transparent"}`} />
            </span>
            {armedMicInput ? <MicIcon className="size-3.5" /> : <MicOffIcon className="size-3.5" />}
            <span className="text-xs">Mic Input</span>
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={onToggleDeviceAudio}
            className={armedDeviceAudio
              ? "gap-1.5 px-2 bg-muted text-foreground"
              : "gap-1.5 px-2 text-muted-foreground"}
            aria-pressed={armedDeviceAudio}
            aria-label={armedDeviceAudio ? "Disable device audio" : "Enable device audio"}
          >
            <span className={`flex size-3.5 items-center justify-center rounded-[4px] border ${armedDeviceAudio ? "border-primary/60 bg-primary/8" : "border-muted-foreground/40 bg-transparent"}`}>
              <span className={`size-1.5 rounded-[2px] ${armedDeviceAudio ? "bg-primary" : "bg-transparent"}`} />
            </span>
            {armedDeviceAudio ? <Volume2Icon className="size-3.5" /> : <VolumeXIcon className="size-3.5" />}
            <span className="text-xs">Device Audio</span>
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={onRecordToggle}
            className={isCapturing ? "w-[92px] gap-1.5 border-destructive/50 text-destructive hover:bg-destructive/10" : "w-[92px] gap-1.5"}
            aria-label={isCapturing ? "Stop recording" : "Start recording"}
          >
            {isCapturing ? (
              <SquareIcon className="size-3 fill-current" data-icon="inline-start" />
            ) : (
              <CircleIcon className="size-3 fill-red-500 text-red-500 dark:fill-red-400 dark:text-red-400" data-icon="inline-start" />
            )}
            <span className="text-xs">{isCapturing ? "Stop" : "Record"}</span>
          </Button>
        </div>

        {/* Status info (right-aligned) */}
        <div className="ml-auto flex shrink-0 items-center gap-2 titlebar-no-drag">
          {uiState && (
            <>
              <StatusBadge status={statusForBadge} />
              {uiState.cost != null && uiState.cost > 0 && (
                <>
                  <Separator orientation="vertical" className="h-4" />
                  <span className="font-mono text-muted-foreground text-xs">
                    ${uiState.cost.toFixed(4)}
                  </span>
                </>
              )}
            </>
          )}
          <Separator orientation="vertical" className="h-4" />
          {onPopOut && (
            <Button
              variant={popupOpen ? "secondary" : "outline"}
              size="sm"
              onClick={onPopOut}
              className="gap-1.5"
              aria-label={popupOpen ? "Close mini window" : "Open mini window"}
              title={popupOpen ? "Close mini window" : "Open mini window"}
            >
              <PanelRightOpenIcon className="size-3.5" />
              <span className="text-xs">{popupOpen ? "Close mini" : "Mini view"}</span>
            </Button>
          )}
          <Button
            variant={settingsOpen ? "secondary" : "ghost"}
            size="icon-sm"
            onClick={onToggleSettings}
            aria-label={settingsOpen ? "Close settings" : "Open settings"}
          >
            <Settings2Icon className="size-3.5" />
          </Button>
        </div>
      </div>

      {langError && (
        <div className="px-4 py-1.5 text-destructive text-xs border-b border-destructive/20 bg-destructive/5">
          {langError}
        </div>
      )}
    </div>
  );
}
