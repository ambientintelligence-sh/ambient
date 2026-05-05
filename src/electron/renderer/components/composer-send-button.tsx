import { ArrowUpIcon, SquareIcon } from "lucide-react";

type ComposerSendButtonProps = {
  onClick?: () => void;
  disabled?: boolean;
  streaming?: boolean;
  onStop?: () => void;
  type?: "button" | "submit";
  className?: string;
};

export function ComposerSendButton({
  onClick,
  disabled,
  streaming,
  onStop,
  type = "button",
  className = "",
}: ComposerSendButtonProps) {
  return (
    <button
      type={streaming && onStop ? "button" : type}
      onClick={streaming && onStop ? onStop : onClick}
      disabled={!streaming && disabled}
      className={[
        "inline-flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-full bg-primary text-primary-foreground shadow-sm transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:bg-primary/35 disabled:text-primary-foreground/70 disabled:shadow-none",
        className,
      ].join(" ")}
      aria-label={streaming ? "Stop" : "Send"}
      title={streaming ? "Stop" : "Send"}
    >
      {streaming ? (
        <SquareIcon className="size-3.5 fill-current" />
      ) : (
        <ArrowUpIcon className="size-3.5" />
      )}
    </button>
  );
}
