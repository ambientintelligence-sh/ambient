import { ArrowLeftIcon, CircleIcon, MicIcon, MicOffIcon, MonitorSpeakerIcon, PlusIcon, Settings2Icon, SquareIcon } from "lucide-react";
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
  onSourceLangChange: (lang: LanguageCode) => void;
  onTargetLangChange: (lang: LanguageCode) => void;
  sessionActive: boolean;
  onStart: () => void;
  onNewSession: () => void;
  onTogglePause: () => void;
  uiState: UIState | null;
  langError: string;
  onToggleTranslation?: () => void;
  onSetTranslationMode?: (direction: Direction | "off", targetLang?: LanguageCode) => void;
  onToggleMic?: () => void;
  onEndSession?: () => void;
  settingsOpen?: boolean;
  onToggleSettings?: () => void;
};

function StatusBadge({ status }: { status: UIState["status"] }) {
  if (status === "recording" || status === "connecting") {
    return (
      <Badge className="gap-1.5 font-normal bg-red-600 text-white hover:bg-red-600 dark:bg-red-500 dark:hover:bg-red-500 border-transparent">
        <span className="relative flex size-2">
          <span className="absolute inset-0 rounded-full bg-white/40 animate-ping" />
          <span className="relative inline-flex size-2 rounded-full bg-white" />
        </span>
        {status === "connecting" ? "Connecting..." : "Recording"}
      </Badge>
    );
  }

  const config = {
    idle: { label: "Idle" },
    paused: { label: "Paused" },
  }[status];

  return (
    <Badge variant="secondary" className="gap-1.5 font-normal">
      <span className="inline-block w-2 h-2 rounded-full bg-muted-foreground/40" />
      {config.label}
    </Badge>
  );
}

function renderLabel(languages: Language[], code: LanguageCode) {
  const lang = languages.find((l) => l.code === code);
  return lang ? lang.native : code.toUpperCase();
}

function encodeTranslateValue(direction: Direction, lang: LanguageCode): string {
  return `${direction}:${lang}`;
}

function decodeTranslateValue(value: string): { direction: Direction | "off"; lang?: LanguageCode } {
  if (value === "off") return { direction: "off" };
  const [dir, code] = value.split(":");
  return { direction: dir as Direction, lang: code as LanguageCode };
}

function getTranslateDisplayLabel(lang: LanguageCode): string {
  const l = SUPPORTED_LANGUAGES.find((x) => x.code === lang);
  return l?.native ?? lang.toUpperCase();
}

export function ToolbarHeader({
  languages,
  sourceLang,
  targetLang,
  onSourceLangChange,
  onTargetLangChange,
  sessionActive,
  onStart,
  onNewSession,
  onTogglePause,
  uiState,
  langError,
  onToggleTranslation: _onToggleTranslation,
  onSetTranslationMode,
  onToggleMic,
  onEndSession,
  settingsOpen,
  onToggleSettings,
}: ToolbarHeaderProps) {
  const isRecordingOrConnecting =
    uiState?.status === "recording" || uiState?.status === "connecting";
  const hasRecorded =
    uiState?.status === "recording" || uiState?.status === "connecting" || uiState?.status === "paused";
  const loading = languages.length === 0;
  const canTranslate = uiState?.canTranslate ?? false;
  const translationEnabled = (uiState?.translationEnabled ?? false) && canTranslate;
  const currentDirection = uiState?.direction ?? "auto";
  const micEnabled = uiState?.micEnabled ?? false;
  const logoUrl = new URL("../../../../assets/ambient-eclipse.svg", import.meta.url).href;

  const translateValue = translationEnabled
    ? encodeTranslateValue(currentDirection, targetLang)
    : "off";

  const availableFromLanguages = SUPPORTED_LANGUAGES.filter((l) => l.code !== sourceLang);

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
        className="titlebar-drag border-b border-border pl-20 pr-4 flex items-center gap-3 h-11 text-sm relative"
        data-window-title="Ambient"
      >
        {/* Logo */}
        <div className="titlebar-no-drag flex items-center gap-0.5">
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

        {/* Translate + Language selector */}
        <div className="flex items-center gap-1.5 titlebar-no-drag">
          {canTranslate && sessionActive && (
            <Select
              value={translateValue}
              onValueChange={(v) => {
                if (v === "off") {
                  onSetTranslationMode?.("off");
                } else {
                  const { direction, lang: tl } = decodeTranslateValue(v);
                  if (direction !== "off" && tl) {
                    onSetTranslationMode?.(direction, tl);
                  }
                }
              }}
            >
              <SelectTrigger size="sm" className={`w-36 ${translationEnabled ? "border-primary/40" : ""}`}>
                <SelectValue>
                  {translationEnabled ? getTranslateDisplayLabel(targetLang) : "Translate"}
                </SelectValue>
              </SelectTrigger>
              <SelectContent position="popper" align="start" sideOffset={4}>
                <SelectItem value="off">Off</SelectItem>
                <SelectSeparator />
                <SelectGroup>
                  <SelectLabel>Translate from</SelectLabel>
                  {availableFromLanguages.map((lang) => (
                    <SelectItem key={lang.code} value={encodeTranslateValue("auto", lang.code)}>
                      {lang.native} ({lang.name})
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          )}
          <span className="text-xs text-muted-foreground">Language</span>
          <Select
            value={sourceLang}
            onValueChange={(v) => {
              onSourceLangChange(v as LanguageCode);
              if (v === targetLang) {
                const alt = v === "en" ? "ko" : "en";
                onTargetLangChange(alt as LanguageCode);
              }
            }}
            disabled={loading || isRecordingOrConnecting}
          >
            <SelectTrigger size="sm" className="w-32">
              <SelectValue>
                {loading ? "..." : renderLabel(languages, sourceLang)}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {languages.map((lang) => (
                <SelectItem key={lang.code} value={lang.code}>
                  <span className="font-mono text-2xs opacity-60 mr-1.5">
                    {lang.code.toUpperCase()}
                  </span>
                  {lang.name}
                  <span className="text-muted-foreground ml-1.5">({lang.native})</span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <Separator orientation="vertical" className="h-4" />

        {/* Action buttons */}
        <div className="flex items-center gap-1.5 titlebar-no-drag">
          {!sessionActive ? (
            <Button size="sm" onClick={onStart} disabled={loading}>
              <PlusIcon className="size-3.5" data-icon="inline-start" />
              New Session
            </Button>
          ) : (
            <>
              <Button variant="outline" size="sm" onClick={onNewSession}>
                <PlusIcon className="size-3.5" data-icon="inline-start" />
                New
              </Button>
              <Button variant="outline" size="sm" onClick={onEndSession} className="text-destructive hover:bg-destructive/10">
                <SquareIcon className="size-3 fill-current" data-icon="inline-start" />
                End
              </Button>
            </>
          )}
        </div>

        {/* Mode toggles */}
        {sessionActive && (
          <>
            <Separator orientation="vertical" className="h-4" />
            <div className="flex items-center gap-1.5 titlebar-no-drag">
              {hasRecorded ? (
                <>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={onTogglePause}
                    className={isRecordingOrConnecting
                      ? "bg-red-600 hover:bg-red-700 text-white border-red-600 dark:bg-red-500 dark:hover:bg-red-600 dark:border-red-500 gap-1.5"
                      : "gap-1.5"}
                    aria-label={isRecordingOrConnecting ? "Pause computer audio" : "Resume computer audio"}
                  >
                    {isRecordingOrConnecting && (
                      <span className="relative flex size-2">
                        <span className="absolute inset-0 rounded-full bg-white/60 mic-pulse-ring" />
                        <span className="relative inline-flex size-2 rounded-full bg-white" />
                      </span>
                    )}
                    <MonitorSpeakerIcon className="size-3.5" />
                    <span className="text-xs">Computer Audio</span>
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={onToggleMic}
                    className={micEnabled
                      ? "bg-red-600 hover:bg-red-700 text-white border-red-600 dark:bg-red-500 dark:hover:bg-red-600 dark:border-red-500 gap-1.5"
                      : "gap-1.5"}
                    aria-label={micEnabled ? "Turn off microphone" : "Turn on microphone"}
                  >
                    {micEnabled ? (
                      <>
                        <span className="relative flex size-2">
                          <span className="absolute inset-0 rounded-full bg-white/60 mic-pulse-ring" />
                          <span className="relative inline-flex size-2 rounded-full bg-white" />
                        </span>
                        <MicIcon className="size-3.5" />
                      </>
                    ) : (
                      <MicOffIcon className="size-3.5" />
                    )}
                    <span className="text-xs">My Voice</span>
                  </Button>
                </>
              ) : (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={onTogglePause}
                  className="gap-1.5"
                  aria-label="Start recording"
                >
                  <CircleIcon className="size-3 fill-red-500 text-red-500 dark:fill-red-400 dark:text-red-400" />
                  <span className="text-xs">Record</span>
                </Button>
              )}
            </div>
          </>
        )}

        {/* Status info (right-aligned) */}
        <div className="ml-auto flex items-center gap-2 titlebar-no-drag">
          {uiState && (
            <>
              <StatusBadge status={uiState.status} />
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
