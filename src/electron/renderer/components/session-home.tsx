import { useState, type KeyboardEvent } from "react";
import { useLocalStorage } from "usehooks-ts";
import {
  ArrowRightLeftIcon,
  ArrowUpIcon,
  CircleIcon,
  Folder,
  MicIcon,
  MicOffIcon,
  SquareIcon,
  Volume2Icon,
  VolumeXIcon,
} from "lucide-react";
import type { Agent, Direction, Language, LanguageCode, UIState } from "@core/types";
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
import { HugeiconsIcon } from "@hugeicons/react";
import { WorkoutRunIcon } from "@hugeicons/core-free-icons";

type SessionHomeTab = "chats" | "sources";

type SessionHomeProps = {
  sessionTitle: string;
  agents: Agent[];
  selectedAgentId: string | null;
  onSelectAgent: (agentId: string) => void;
  onLaunchAgent: (task: string) => void;
  onRecordToggle: () => void;
  onToggleMicInput: () => void;
  onToggleDeviceAudio: () => void;
  armedMicInput: boolean;
  armedDeviceAudio: boolean;
  uiState: UIState | null;
  languages: Language[];
  sourceLang: LanguageCode;
  targetLang: LanguageCode;
  translateToSelection: LanguageCode | "off";
  onSourceLangChange: (lang: LanguageCode) => void;
  onTargetLangChange: (lang: LanguageCode) => void;
  onTranslateToSelectionChange: (value: LanguageCode | "off") => void;
  onSetTranslationMode?: (direction: Direction | "off", targetLang?: LanguageCode) => void;
};

function getLanguageNative(lang: LanguageCode): string {
  return SUPPORTED_LANGUAGES.find((l) => l.code === lang)?.native ?? lang.toUpperCase();
}

function relativeTime(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ago`;
}

export function SessionHome({
  sessionTitle,
  agents,
  selectedAgentId,
  onSelectAgent,
  onLaunchAgent,
  onRecordToggle,
  onToggleMicInput,
  onToggleDeviceAudio,
  armedMicInput,
  armedDeviceAudio,
  uiState,
  languages,
  sourceLang,
  targetLang,
  translateToSelection,
  onSourceLangChange,
  onTargetLangChange,
  onTranslateToSelectionChange,
  onSetTranslationMode,
}: SessionHomeProps) {
  const [tab, setTab] = useLocalStorage<SessionHomeTab>("ambient-session-home-tab", "chats");
  const [taskDraft, setTaskDraft] = useState("");

  const submitTask = () => {
    const trimmed = taskDraft.trim();
    if (!trimmed) return;
    onLaunchAgent(trimmed);
    setTaskDraft("");
  };

  const handleInputKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      submitTask();
    }
  };

  const isDeviceAudioActive =
    uiState?.status === "recording" || uiState?.status === "connecting";
  const isMicActive = uiState?.micEnabled ?? false;
  const isCapturing = isDeviceAudioActive || isMicActive;
  const canTranslate = uiState?.canTranslate ?? false;
  const currentDirection: Direction = uiState?.direction ?? "auto";

  const languageOptions = languages.length > 0 ? languages : SUPPORTED_LANGUAGES;
  const availableTargetLanguages = SUPPORTED_LANGUAGES.filter((l) => l.code !== sourceLang);

  const canSubmit = taskDraft.trim().length > 0;

  return (
    <div className="flex-1 min-h-0 overflow-y-auto">
      <div className="mx-auto w-full max-w-2xl px-6 pt-12 pb-8 flex flex-col gap-6">
        <div className="flex items-center gap-2 text-base font-medium text-foreground">
          <Folder className="size-4 text-muted-foreground" />
          <span className="truncate">{sessionTitle}</span>
        </div>

        <div className="rounded-2xl border border-border bg-background shadow-sm">
          <textarea
            rows={2}
            value={taskDraft}
            onChange={(e) => setTaskDraft(e.target.value)}
            onKeyDown={handleInputKeyDown}
            placeholder={`New chat in ${sessionTitle}`}
            className="block w-full resize-none border-0 bg-transparent px-4 pt-3 pb-1 text-sm text-foreground placeholder:text-muted-foreground/70 focus:outline-none focus:ring-0"
          />

          <div className="flex items-center gap-1 px-2 pb-2">
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
                className="h-7 border-0 bg-transparent px-2 text-2xs text-muted-foreground hover:bg-muted/60 hover:text-foreground"
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
                className="h-7 border-0 bg-transparent px-2 text-2xs text-muted-foreground hover:bg-muted/60 hover:text-foreground"
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

            <button
              type="button"
              onClick={onToggleMicInput}
              className={`shrink-0 cursor-pointer rounded-md p-1.5 transition-colors hover:bg-muted/60 ${
                armedMicInput ? "text-foreground" : "text-muted-foreground"
              }`}
              title={armedMicInput ? "Mic input armed" : "Mic input disabled"}
              aria-label={armedMicInput ? "Disable mic input" : "Enable mic input"}
              aria-pressed={armedMicInput}
            >
              {armedMicInput ? <MicIcon className="size-3.5" /> : <MicOffIcon className="size-3.5" />}
            </button>

            <button
              type="button"
              onClick={onToggleDeviceAudio}
              className={`shrink-0 cursor-pointer rounded-md p-1.5 transition-colors hover:bg-muted/60 ${
                armedDeviceAudio ? "text-foreground" : "text-muted-foreground"
              }`}
              title={armedDeviceAudio ? "Device audio armed" : "Device audio disabled"}
              aria-label={armedDeviceAudio ? "Disable device audio" : "Enable device audio"}
              aria-pressed={armedDeviceAudio}
            >
              {armedDeviceAudio ? <Volume2Icon className="size-3.5" /> : <VolumeXIcon className="size-3.5" />}
            </button>

            <button
              type="button"
              onClick={onRecordToggle}
              className={`shrink-0 cursor-pointer rounded-md p-1.5 transition-colors hover:bg-muted/60 ${
                isCapturing ? "text-destructive" : "text-muted-foreground"
              }`}
              aria-label={isCapturing ? "Stop recording" : "Start recording"}
              title={isCapturing ? "Stop recording" : "Start recording"}
            >
              {isCapturing ? (
                <SquareIcon className="size-3.5 fill-current" />
              ) : (
                <CircleIcon className="size-3.5 fill-red-500 text-red-500" />
              )}
            </button>

            <button
              type="button"
              onClick={submitTask}
              disabled={!canSubmit}
              className={`ml-1 shrink-0 cursor-pointer rounded-full p-1.5 transition-colors ${
                canSubmit
                  ? "bg-foreground text-background hover:bg-foreground/90"
                  : "bg-muted text-muted-foreground cursor-not-allowed"
              }`}
              aria-label="Send"
              title="Send"
            >
              <ArrowUpIcon className="size-3.5" />
            </button>
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          <TabPill active={tab === "chats"} onClick={() => setTab("chats")}>
            Chats
          </TabPill>
          <TabPill active={tab === "sources"} onClick={() => setTab("sources")}>
            Sources
          </TabPill>
        </div>

        {tab === "chats" ? (
          agents.length > 0 ? (
            <ul className="flex flex-col gap-1">
              {agents.map((agent) => (
                <li key={agent.id}>
                  <button
                    type="button"
                    onClick={() => onSelectAgent(agent.id)}
                    className={`w-full cursor-pointer text-left rounded-md border px-3 py-2 transition-colors ${
                      selectedAgentId === agent.id
                        ? "border-primary/30 bg-primary/5"
                        : "border-transparent hover:border-border/60 hover:bg-muted/40"
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <HugeiconsIcon
                        icon={WorkoutRunIcon}
                        className={`size-3.5 shrink-0 ${
                          agent.status === "running"
                            ? "text-primary animate-pulse"
                            : agent.status === "completed"
                              ? "text-green-500"
                              : "text-muted-foreground"
                        }`}
                      />
                      <p className="text-xs text-foreground truncate flex-1">{agent.task}</p>
                      <span className="text-2xs text-muted-foreground shrink-0 font-mono">
                        {relativeTime(agent.completedAt ?? agent.createdAt)}
                      </span>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <div className="flex flex-col items-center justify-center py-10 text-center">
              <p className="text-sm font-medium text-foreground">No chats yet</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Chats in {sessionTitle} will live here
              </p>
            </div>
          )
        ) : (
          <div className="flex flex-col items-center justify-center py-10 text-center">
            <p className="text-sm font-medium text-foreground">No sources yet</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Sources in {sessionTitle} will live here
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

function TabPill({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`cursor-pointer rounded-full px-3 py-1 text-xs transition-colors ${
        active
          ? "bg-muted text-foreground"
          : "text-muted-foreground hover:text-foreground hover:bg-muted/60"
      }`}
    >
      {children}
    </button>
  );
}
