import { Separator } from "@/components/ui/separator";
import { Settings2Icon } from "lucide-react";

type FooterProps = {
  sessionActive: boolean;
  statusText: string;
  onQuit: () => void;
  settingsOpen?: boolean;
  onToggleSettings: () => void;
};

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="px-1.5 py-0.5 rounded-sm bg-secondary font-mono text-2xs text-secondary-foreground">
      {children}
    </kbd>
  );
}

export function Footer({ sessionActive, statusText, onQuit, settingsOpen, onToggleSettings }: FooterProps) {
  return (
    <div className="border-t border-border px-3 py-1.5 flex items-center gap-2 text-xs text-muted-foreground h-8 shrink-0">
      <button
        type="button"
        onClick={onToggleSettings}
        className={`flex h-7 items-center gap-2 rounded-sm px-2 text-sm font-medium transition-colors hover:bg-muted hover:text-foreground ${
          settingsOpen ? "bg-muted text-foreground" : ""
        }`}
        aria-label={settingsOpen ? "Close settings" : "Open settings"}
        title={settingsOpen ? "Close settings" : "Open settings"}
      >
        <Settings2Icon className="size-4" strokeWidth={2} />
        <span>Settings</span>
      </button>
      {sessionActive ? (
        <>
          {statusText && (
            <>
              <Separator orientation="vertical" className="h-3 mx-0.5" />
              <span className="font-mono text-muted-foreground truncate">
                {statusText}
              </span>
            </>
          )}
          <div className="ml-auto flex items-center gap-2">
            <Kbd>Space</Kbd>
            <span>record</span>
            <Separator orientation="vertical" className="h-3 mx-0.5" />
            <button
              type="button"
              onClick={onQuit}
              className="flex items-center gap-1.5 hover:text-foreground transition-colors"
            >
              <Kbd>Q</Kbd>
              <span>end session</span>
            </button>
          </div>
        </>
      ) : (
        <>
          <div className="ml-auto flex items-center gap-2">
            <Kbd>Space</Kbd>
            <span>start</span>
            <Separator orientation="vertical" className="h-3 mx-0.5" />
            <button
              type="button"
              onClick={onQuit}
              className="flex items-center gap-1.5 hover:text-foreground transition-colors"
            >
              <Kbd>Q</Kbd>
              <span>quit</span>
            </button>
          </div>
        </>
      )}
    </div>
  );
}
