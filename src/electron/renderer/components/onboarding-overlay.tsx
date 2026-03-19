import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { ArrowRightIcon, KeyIcon } from "lucide-react";
import { useUIStore } from "../stores/ui-store";

type OnboardingOverlayProps = {
  panelLayoutRef: React.RefObject<HTMLDivElement | null>;
  onSetUpKeys: () => void;
  onDismiss: () => void;
};

const TOUR_STEPS = [
  {
    panel: 0 as const,
    title: "Sessions",
    body: "Every conversation lives here. Click one to revisit it.",
  },
  {
    panel: 1 as const,
    title: "Transcript",
    body: "Words appear as people talk. Scroll through this demo to see it.",
  },
  {
    panel: 2 as const,
    title: "Tasks",
    body: "Suggestions surface as you talk — accept one to put an agent on it.",
  },
  {
    panel: 2 as const,
    title: "Agents",
    body: "They research, plan, and execute autonomously. Click one to see its work.",
  },
  {
    panel: 1 as const,
    title: "Summary",
    body: "After a session, you get decisions, action items, and blind spots in one place.",
  },
];

const TOTAL_STEPS = TOUR_STEPS.length + 1;

type PanelRect = { left: number; top: number; width: number; height: number };

function getPanelRects(layoutEl: HTMLDivElement): PanelRect[] {
  const children = Array.from(layoutEl.children) as HTMLElement[];
  const panels: PanelRect[] = [];
  for (const child of children) {
    if (child.getAttribute("role") === "separator") continue;
    const rect = child.getBoundingClientRect();
    panels.push({ left: rect.left, top: rect.top, width: rect.width, height: rect.height });
  }
  return panels;
}

function ProgressBar({ current, total }: { current: number; total: number }) {
  return (
    <div className="flex items-center gap-0.5">
      {Array.from({ length: total }, (_, i) => (
        <div
          key={i}
          className={`h-[2px] rounded-full transition-all duration-300 ${
            i <= current
              ? "w-4 bg-foreground/70"
              : "w-2 bg-muted-foreground/15"
          }`}
        />
      ))}
    </div>
  );
}

export function OnboardingOverlay({
  panelLayoutRef,
  onSetUpKeys,
  onDismiss,
}: OnboardingOverlayProps) {
  const tourStep = useUIStore((s) => s.tourStep);
  const advanceTourStep = useUIStore((s) => s.advanceTourStep);
  const [panelRects, setPanelRects] = useState<PanelRect[]>([]);

  useEffect(() => {
    function measure() {
      if (!panelLayoutRef.current) return;
      setPanelRects(getPanelRects(panelLayoutRef.current));
    }
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [panelLayoutRef]);

  const onDismissRef = useRef(onDismiss);
  onDismissRef.current = onDismiss;

  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") onDismissRef.current();
    };
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, []);

  const step = Math.min(tourStep, TOUR_STEPS.length);
  const isGetStartedStep = step >= TOUR_STEPS.length;

  // --- Final "Ready to go" card ---
  if (isGetStartedStep) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm">
        <style>{`
          @keyframes onboarding-final-in {
            from { opacity: 0; transform: scale(0.98) translateY(8px); }
            to { opacity: 1; transform: scale(1) translateY(0); }
          }
        `}</style>
        <div
          className="w-full max-w-[340px] overflow-hidden rounded-xl border border-border/60 bg-popover shadow-2xl"
          style={{
            opacity: 0,
            animation: "onboarding-final-in 400ms cubic-bezier(0.16, 1, 0.3, 1) forwards",
          }}
        >
          {/* Accent bar */}
          <div className="h-px bg-gradient-to-r from-transparent via-foreground/20 to-transparent" />

          <div className="px-6 pb-6 pt-5">
            <p className="mb-1 text-[11px] font-medium uppercase tracking-widest text-muted-foreground/50">
              One more thing
            </p>
            <h2 className="mb-2 text-[22px] font-semibold leading-tight tracking-tight text-popover-foreground">
              Ready to go
            </h2>
            <p className="mb-6 text-[13px] leading-relaxed text-muted-foreground">
              Add an OpenRouter API key to start capturing
              your own conversations.
            </p>

            <div className="flex items-center justify-between">
              <ProgressBar current={step} total={TOTAL_STEPS} />
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  className="px-2 py-1 text-xs text-muted-foreground/60 transition-colors hover:text-foreground cursor-pointer"
                  onClick={onDismiss}
                >
                  Later
                </button>
                <Button size="sm" onClick={onSetUpKeys}>
                  <KeyIcon className="mr-1.5 size-3.5" />
                  Add API key
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // --- Spotlight tour steps ---
  const currentStep = TOUR_STEPS[step];
  const targetRect = panelRects[currentStep.panel];

  const padding = 4;
  const spotLeft = targetRect ? targetRect.left - padding : 0;
  const spotTop = targetRect ? targetRect.top - padding : 0;
  const spotWidth = targetRect ? targetRect.width + padding * 2 : 0;
  const spotHeight = targetRect ? targetRect.height + padding * 2 : 0;

  const getTooltipStyle = (): React.CSSProperties => {
    if (!targetRect) return { left: "50%", top: "50%", transform: "translate(-50%, -50%)" };

    if (currentStep.panel === 0) {
      return {
        left: targetRect.left + targetRect.width + 16,
        top: targetRect.top + targetRect.height * 0.3,
        transform: "translateY(-50%)",
      };
    }
    if (currentStep.panel === 2) {
      return {
        left: targetRect.left - 16,
        top: targetRect.top + targetRect.height * 0.3,
        transform: "translate(-100%, -50%)",
      };
    }
    return {
      left: targetRect.left + targetRect.width / 2,
      top: targetRect.top + targetRect.height - 24,
      transform: "translate(-50%, -100%)",
    };
  };

  return (
    <div
      className="fixed inset-0 z-50"
      onPointerDown={(event) => {
        event.preventDefault();
      }}
      onClick={(event) => {
        event.preventDefault();
      }}
    >
      <style>{`
        @keyframes onboarding-tooltip-in {
          from { opacity: 0; transform: translateY(10px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>

      <svg className="absolute inset-0 size-full">
        <defs>
          <mask id="onboarding-spotlight-mask">
            <rect width="100%" height="100%" fill="white" />
            {targetRect && (
              <rect
                x={spotLeft}
                y={spotTop}
                width={spotWidth}
                height={spotHeight}
                rx={8}
                fill="black"
                style={{ transition: "all 350ms cubic-bezier(0.16, 1, 0.3, 1)" }}
              />
            )}
          </mask>
        </defs>
        <rect
          width="100%"
          height="100%"
          fill="var(--onboarding-overlay, rgba(0,0,0,0.12))"
          mask="url(#onboarding-spotlight-mask)"
        />
      </svg>

      {targetRect && (
        <div
          className="absolute rounded-lg border border-foreground/10 pointer-events-none"
          style={{
            left: spotLeft,
            top: spotTop,
            width: spotWidth,
            height: spotHeight,
            transition: "all 350ms cubic-bezier(0.16, 1, 0.3, 1)",
            boxShadow: "0 0 0 1px var(--background)",
          }}
        />
      )}

      <div
        className="absolute z-10 w-[260px]"
        style={{
          ...getTooltipStyle(),
        }}
        onPointerDown={(event) => {
          event.stopPropagation();
        }}
        onClick={(event) => {
          event.stopPropagation();
        }}
      >
        <div
          key={step}
          className="overflow-hidden rounded-lg border border-border bg-popover shadow-xl"
          style={{
            animation: "onboarding-tooltip-in 300ms cubic-bezier(0.16, 1, 0.3, 1)",
          }}
        >
          {/* Subtle top accent */}
          <div className="h-px bg-gradient-to-r from-transparent via-foreground/15 to-transparent" />

          <div className="px-4 pb-4 pt-3.5">
            <h3 className="mb-0.5 text-[15px] font-semibold tracking-tight text-popover-foreground">
              {currentStep.title}
            </h3>
            <p className="mb-4 text-xs leading-relaxed text-muted-foreground">
              {currentStep.body}
            </p>

            <div className="flex items-center justify-between">
              <ProgressBar current={step} total={TOTAL_STEPS} />

              <div className="flex items-center gap-1">
                <button
                  type="button"
                  className="px-2 py-1 text-xs text-muted-foreground/50 transition-colors hover:text-foreground cursor-pointer"
                  onClick={onDismiss}
                >
                  Skip
                </button>
                <Button size="sm" variant="ghost" onClick={advanceTourStep}>
                  Next
                  <ArrowRightIcon className="ml-1 size-3" />
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
