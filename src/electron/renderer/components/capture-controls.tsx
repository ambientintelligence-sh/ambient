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

type CaptureRecordButtonProps = {
  active: boolean;
  status?: UIState["status"];
  onClick: () => void;
  startTitle?: string;
  className?: string;
  style?: CSSProperties;
};

type CaptureToggleButtonProps = {
  active: boolean;
  kind: "mic" | "device-audio";
  onClick: () => void;
  className?: string;
  style?: CSSProperties;
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
          <span>Stop</span>
        </>
      ) : (
        <>
          <CircleIcon className="size-3 fill-red-500 text-red-500" />
          <span>Record</span>
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
}: CaptureToggleButtonProps) {
  const isMic = kind === "mic";
  const label = isMic ? "mic input" : "device audio";
  const Icon = isMic
    ? (active ? MicIcon : MicOffIcon)
    : (active ? Volume2Icon : VolumeXIcon);

  return (
    <button
      type="button"
      onClick={onClick}
      title={active ? `${label[0].toUpperCase()}${label.slice(1)} armed (click to disable)` : `${label[0].toUpperCase()}${label.slice(1)} disabled`}
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
