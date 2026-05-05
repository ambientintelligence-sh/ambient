import {
  CircleIcon,
  MicIcon,
  MicOffIcon,
  SquareIcon,
  Volume2Icon,
  VolumeXIcon,
} from "lucide-react";
import type { CSSProperties } from "react";
import type { UIState } from "@core/types";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

type CaptureRecordButtonProps = {
  active: boolean;
  status?: UIState["status"];
  onClick: () => void;
  startTitle?: string;
  startLabel?: string;
  stopLabel?: string;
  className?: string;
  style?: CSSProperties;
};

type CaptureToggleButtonProps = {
  active: boolean;
  kind: "mic" | "device-audio";
  onClick: () => void;
  className?: string;
  style?: CSSProperties;
  tooltip?: string;
  tooltipSide?: "top" | "right" | "bottom" | "left";
  tooltipMode?: "custom" | "native";
};

type CaptureStatusPillProps = {
  active: boolean;
  status?: UIState["status"];
  label?: string;
  className?: string;
};

export function CaptureRecordButton({
  active,
  status,
  onClick,
  startTitle = "Start recording",
  startLabel = "Record",
  stopLabel = "Stop",
  className = "",
  style,
}: CaptureRecordButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={status === "connecting"}
      title={active ? "Stop recording" : startTitle}
      aria-label={active ? "Stop recording" : startTitle}
      style={style}
      className={[
        "flex h-7 w-[86px] shrink-0 items-center justify-center gap-1.5 rounded-full px-2.5 text-xs font-medium transition-colors cursor-pointer disabled:cursor-not-allowed disabled:opacity-60",
        active
          ? "bg-red-500/15 text-red-600 hover:bg-red-500/25 dark:text-red-300"
          : "bg-foreground/[0.06] text-foreground hover:bg-foreground/[0.12] dark:bg-white/10 dark:hover:bg-white/15",
        className,
      ].join(" ")}
    >
      {active ? (
        <>
          <SquareIcon className="size-3 fill-current" />
          <span>{stopLabel}</span>
        </>
      ) : (
        <>
          <CircleIcon className="size-3 fill-red-500 text-red-500" />
          <span>{startLabel}</span>
        </>
      )}
    </button>
  );
}

export function CaptureToggleButton({
  active,
  kind,
  onClick,
  className = "",
  style,
  tooltip,
  tooltipSide = "bottom",
  tooltipMode = "custom",
}: CaptureToggleButtonProps) {
  const isMic = kind === "mic";
  const label = isMic ? "mic input" : "device audio";
  const Icon = isMic
    ? (active ? MicIcon : MicOffIcon)
    : (active ? Volume2Icon : VolumeXIcon);
  const tooltipText = tooltip ?? (
    isMic
      ? "Captures audio from your microphone."
      : "Captures audio from your device."
  );
  const title = active
    ? `${label[0].toUpperCase()}${label.slice(1)} on`
    : `${label[0].toUpperCase()}${label.slice(1)} off`;

  const button = (
    <button
      type="button"
      onClick={onClick}
      title={tooltipMode === "native" ? tooltipText : undefined}
      aria-label={`Toggle ${label}`}
      aria-pressed={active}
      style={style}
      className={[
        "flex size-7 shrink-0 items-center justify-center rounded-full transition-colors cursor-pointer",
        active
          ? "text-foreground bg-foreground/[0.06] hover:bg-foreground/[0.12] dark:bg-white/10 dark:hover:bg-white/15"
          : "text-muted-foreground/60 hover:text-muted-foreground hover:bg-foreground/[0.06] dark:hover:bg-white/10",
        className,
      ].join(" ")}
    >
      <Icon className="size-3.5" />
    </button>
  );

  if (tooltipMode === "native") return button;

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>{button}</TooltipTrigger>
        <TooltipContent side={tooltipSide} sideOffset={6}>
          <div className="max-w-[220px]">
            <div className="font-medium">{title}</div>
            <div className="mt-0.5 opacity-80">{tooltipText}</div>
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

export function CaptureStatusPill({
  active,
  status,
  label,
  className = "",
}: CaptureStatusPillProps) {
  return (
    <span className={["inline-flex min-w-0 items-center gap-1.5", className].join(" ")}>
      {active ? (
        <span className="relative flex size-2 shrink-0">
          <span className="absolute inset-0 rounded-full bg-red-500/35 animate-ping" />
          <span className="relative inline-flex size-2 rounded-full bg-red-500" />
        </span>
      ) : (
        <span className="inline-block size-2 shrink-0 rounded-full bg-muted-foreground/40" />
      )}
      <span className={active ? "truncate text-red-600/80 dark:text-red-300/80" : "truncate text-muted-foreground"}>
        {status === "connecting" ? "Connecting..." : active ? "Recording" : (label ?? "Idle")}
      </span>
    </span>
  );
}
