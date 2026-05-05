import {
  ArrowLeftIcon,
  ArrowRightIcon,
  Minimize2Icon,
  PanelLeftCloseIcon,
  PanelLeftOpenIcon,
  PanelRightCloseIcon,
  PanelRightOpenIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import type { UIState } from "@core/types";
import { CaptureStatusPill } from "./capture-controls";

type TopBarProps = {
  title: string;
  leftPanelCollapsed?: boolean;
  onToggleLeftPanel?: () => void;
  agentOpen?: boolean;
  canNavigateBack?: boolean;
  canNavigateForward?: boolean;
  onNavigateBack?: () => void;
  onNavigateForward?: () => void;
  popupOpen?: boolean;
  onPopOut: () => void;
  rightPanelOpen: boolean;
  onToggleRightPanel: () => void;
  captureActive?: boolean;
  captureStatus?: UIState["status"];
};

export function TopBar({
  title,
  leftPanelCollapsed,
  onToggleLeftPanel,
  agentOpen,
  canNavigateBack,
  canNavigateForward,
  onNavigateBack,
  onNavigateForward,
  popupOpen,
  onPopOut,
  rightPanelOpen,
  onToggleRightPanel,
  captureActive = false,
  captureStatus,
}: TopBarProps) {
  return (
    <div
      className="titlebar-drag shrink-0 relative flex items-center h-10 border-b border-border bg-background pl-20 pr-2 gap-2"
      data-window-title="Ambient"
    >
      {onToggleLeftPanel && (
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={onToggleLeftPanel}
          className="titlebar-no-drag translate-y-px"
          aria-label={leftPanelCollapsed ? "Expand left panel" : "Collapse left panel"}
          title={leftPanelCollapsed ? "Expand left panel" : "Collapse left panel"}
        >
          {leftPanelCollapsed ? (
            <PanelLeftOpenIcon className="size-3.5" />
          ) : (
            <PanelLeftCloseIcon className="size-3.5" />
          )}
        </Button>
      )}

      <div className="titlebar-no-drag flex shrink-0 translate-y-px items-center gap-0.5">
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={onNavigateBack}
          disabled={!canNavigateBack}
          aria-label={agentOpen ? "Back to previous view" : "Back"}
          title={agentOpen ? "Back to previous view" : "Back"}
        >
          <ArrowLeftIcon className="size-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={onNavigateForward}
          disabled={!canNavigateForward}
          aria-label="Forward"
          title="Forward"
        >
          <ArrowRightIcon className="size-3.5" />
        </Button>
      </div>

      <div className="pointer-events-none absolute left-1/2 top-1/2 flex w-[min(48vw,32rem)] -translate-x-1/2 -translate-y-1/2 items-center justify-center gap-2 text-center">
        <span className="block truncate text-xs font-medium text-foreground">{title}</span>
        {captureStatus && captureStatus !== "idle" && (
          <CaptureStatusPill
            active={captureActive}
            status={captureStatus}
            className="shrink-0 text-2xs"
          />
        )}
      </div>

      <div className="flex-1" />

      <div className="titlebar-no-drag flex shrink-0 translate-y-px items-center gap-0.5">
        <Button
          variant={popupOpen ? "secondary" : "ghost"}
          size="sm"
          onClick={onPopOut}
          className="h-7 gap-1.5 px-2 text-xs"
          aria-label={popupOpen ? "Close mini window" : "Open mini window"}
          title={popupOpen ? "Close mini window" : "Open mini window"}
        >
          <Minimize2Icon className="size-3.5" />
          <span>Mini</span>
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={onToggleRightPanel}
          aria-label={rightPanelOpen ? "Hide right panel" : "Show right panel"}
          title={rightPanelOpen ? "Hide right panel" : "Show right panel"}
        >
          {rightPanelOpen ? (
            <PanelRightCloseIcon className="size-3.5" />
          ) : (
            <PanelRightOpenIcon className="size-3.5" />
          )}
        </Button>
      </div>
    </div>
  );
}
