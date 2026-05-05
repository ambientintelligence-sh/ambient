import { ChevronDownIcon, BrainIcon, CheckIcon } from "lucide-react";
import type { AppConfig } from "@core/types";
import {
  MODEL_CONFIG,
  REASONING_EFFORT_LABELS,
  type ModelPreset,
  type ReasoningEffort,
} from "@core/models";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

type ModelPickerProps = {
  config: AppConfig;
  onConfigChange: (next: AppConfig) => void;
};

const REASONING_PILLS: Array<{ value: ReasoningEffort | "off"; label: string }> = [
  { value: "off", label: "Off" },
  { value: "low", label: REASONING_EFFORT_LABELS.low },
  { value: "medium", label: REASONING_EFFORT_LABELS.medium },
  { value: "high", label: REASONING_EFFORT_LABELS.high },
  { value: "xhigh", label: REASONING_EFFORT_LABELS.xhigh },
];

function getActiveProviderModels(provider: AppConfig["analysisProvider"]): ModelPreset[] {
  if (provider === "openrouter" || provider === "openai-codex") {
    return MODEL_CONFIG[provider].models;
  }
  return MODEL_CONFIG.openrouter.models;
}

function findPreset(provider: AppConfig["analysisProvider"], modelId: string): ModelPreset | undefined {
  return getActiveProviderModels(provider).find((p) => p.modelId === modelId);
}

function effortLabel(config: AppConfig, preset: ModelPreset | undefined): string | undefined {
  if (!preset?.reasoning || !config.analysisReasoning) return undefined;
  const effort = config.analysisReasoningEffort ?? preset.reasoningEffort;
  return effort ? REASONING_EFFORT_LABELS[effort] : undefined;
}

export function ModelPicker({ config, onConfigChange }: ModelPickerProps) {
  const models = getActiveProviderModels(config.analysisProvider);
  const activePreset = findPreset(config.analysisProvider, config.analysisModelId);
  const activeLabel = activePreset?.label ?? config.analysisModelId;
  const activeEffortLabel = effortLabel(config, activePreset);

  const supportsReasoning = !!activePreset?.reasoning;
  const currentEffort: ReasoningEffort | "off" = !config.analysisReasoning
    ? "off"
    : (config.analysisReasoningEffort ?? activePreset?.reasoningEffort ?? "medium");

  const handleSelectModel = (preset: ModelPreset) => {
    onConfigChange({
      ...config,
      analysisModelId: preset.modelId,
      analysisReasoning: !!preset.reasoning,
      analysisProviderOnly: preset.providerOnly,
      analysisReasoningEffort: undefined,
    });
  };

  const handleSelectEffort = (value: ReasoningEffort | "off") => {
    if (value === "off") {
      onConfigChange({
        ...config,
        analysisReasoning: false,
        analysisReasoningEffort: undefined,
      });
      return;
    }
    onConfigChange({
      ...config,
      analysisReasoning: true,
      analysisReasoningEffort: value,
    });
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="inline-flex h-7 max-w-[220px] cursor-pointer items-center gap-1 rounded-full px-2 text-2xs text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
          title="Choose agent model and reasoning level"
        >
          {supportsReasoning && (
            <BrainIcon className="size-3 shrink-0 text-muted-foreground/70" />
          )}
          <span className="truncate">{activeLabel}</span>
          {activeEffortLabel && (
            <span className="shrink-0 text-muted-foreground/60">· {activeEffortLabel}</span>
          )}
          <ChevronDownIcon className="size-3 shrink-0 text-muted-foreground/60" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        sideOffset={6}
        className="w-72 p-0"
      >
        <div className="px-2 py-1.5 text-2xs uppercase tracking-wider text-muted-foreground/70">
          Model
        </div>
        <ul className="max-h-72 overflow-y-auto px-1 pb-1">
          {models.map((preset) => {
            const isActive = preset.modelId === config.analysisModelId;
            return (
              <li key={preset.modelId}>
                <button
                  type="button"
                  onClick={() => handleSelectModel(preset)}
                  className={[
                    "flex w-full cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-left text-xs transition-colors",
                    isActive
                      ? "bg-accent text-accent-foreground"
                      : "text-foreground hover:bg-accent/60",
                  ].join(" ")}
                >
                  <span className="flex-1 truncate">{preset.label}</span>
                  {!!preset.reasoning && (
                    <BrainIcon className="size-3 shrink-0 text-muted-foreground/60" />
                  )}
                  {isActive && <CheckIcon className="size-3 shrink-0 text-foreground/70" />}
                </button>
              </li>
            );
          })}
        </ul>

        {supportsReasoning && (
          <div className="border-t border-border/60 px-2 py-2">
            <div className="mb-1.5 text-2xs uppercase tracking-wider text-muted-foreground/70">
              Reasoning
            </div>
            <div className="flex flex-wrap gap-1">
              {REASONING_PILLS.map((pill) => {
                const isActive = currentEffort === pill.value;
                return (
                  <button
                    key={pill.value}
                    type="button"
                    onClick={() => handleSelectEffort(pill.value)}
                    className={[
                      "inline-flex h-6 cursor-pointer items-center rounded-full px-2 text-2xs transition-colors",
                      isActive
                        ? "bg-foreground text-background"
                        : "bg-muted/60 text-muted-foreground hover:bg-muted hover:text-foreground",
                    ].join(" ")}
                  >
                    {pill.label}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
