import { Minimize2Icon, PanelRightCloseIcon, PanelRightOpenIcon, Settings2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";

type TopBarProps = {
  title: string;
  settingsOpen?: boolean;
  onToggleSettings: () => void;
  popupOpen?: boolean;
  onPopOut: () => void;
  rightPanelOpen: boolean;
  onToggleRightPanel: () => void;
};

export function TopBar({
  title,
  settingsOpen,
  onToggleSettings,
  popupOpen,
  onPopOut,
  rightPanelOpen,
  onToggleRightPanel,
}: TopBarProps) {
  return (
    <div
      className="titlebar-drag shrink-0 flex items-center h-9 border-b border-border bg-background pl-20 pr-2 gap-2"
      data-window-title="Ambient"
    >
      <div className="titlebar-no-drag min-w-0 flex-1 flex items-center">
        <span className="truncate text-xs font-medium text-foreground">{title}</span>
      </div>

      <div className="titlebar-no-drag flex shrink-0 items-center gap-0.5">
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
          variant={settingsOpen ? "secondary" : "ghost"}
          size="icon-sm"
          onClick={onToggleSettings}
          aria-label={settingsOpen ? "Close settings" : "Open settings"}
          title={settingsOpen ? "Close settings" : "Open settings"}
        >
          <Settings2Icon className="size-3.5" />
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
