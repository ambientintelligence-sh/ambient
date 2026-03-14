import { Separator } from "@/components/ui/separator";

type FooterProps = {
  sessionActive: boolean;
  statusText: string;
  onQuit: () => void;
};

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="px-1.5 py-0.5 rounded-sm bg-secondary font-mono text-2xs text-secondary-foreground">
      {children}
    </kbd>
  );
}

export function Footer({ sessionActive, statusText, onQuit }: FooterProps) {
  return (
    <div className="border-t border-border px-4 py-1.5 flex items-center gap-2 text-xs text-muted-foreground h-8 shrink-0">
      {sessionActive ? (
        <>
          <Kbd>Space</Kbd>
          <span>record</span>
          <Separator orientation="vertical" className="h-3 mx-0.5" />
          <Kbd>{"\u2191\u2193"}</Kbd>
          <span>scroll</span>
          <Separator orientation="vertical" className="h-3 mx-0.5" />
          <Kbd>End</Kbd>
          <span>summary</span>
          {statusText && (
            <>
              <Separator orientation="vertical" className="h-3 mx-0.5" />
              <span className="font-mono text-muted-foreground truncate">
                {statusText}
              </span>
            </>
          )}
          <div className="ml-auto">
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
          <Kbd>Space</Kbd>
          <span>start</span>
          <div className="ml-auto">
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
