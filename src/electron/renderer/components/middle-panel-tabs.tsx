import { useState, useEffect, useRef, type ReactNode } from "react";
import { XIcon } from "lucide-react";
import type { Agent } from "@core/types";
import type { SummaryModalState } from "./session-summary-modal";

type TabId = "transcript" | "summary" | "new-agent" | `agent:${string}`;
const EMPTY_SESSION_TAB_KEY = "__empty__";

type MiddlePanelTabsProps = {
  sessionId?: string | null;
  transcriptContent: ReactNode;
  summaryContent: ReactNode;
  agentContent: ReactNode;
  summaryState: SummaryModalState;
  newAgentMode?: boolean;
  openAgentIds: string[];
  agentTabTitles?: Record<string, string>;
  selectedAgentId?: string | null;
  agentSelectionNonce: number;
  onSelectAgent: (agentId: string) => void;
  onCloseAgent: (agentId: string) => void;
  onCloseNewAgent: () => void;
  onGenerateSummary?: () => void;
  agents?: Agent[];
};

function getAgentTabId(agentId: string): `agent:${string}` {
  return `agent:${agentId}`;
}

function isAgentTab(tabId: TabId): tabId is `agent:${string}` {
  return tabId.startsWith("agent:");
}

function TabButton({
  active,
  label,
  onClick,
  onClose,
  tabRef,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
  onClose?: () => void;
  tabRef?: React.RefObject<HTMLButtonElement | null>;
}) {
  return (
    <button
      ref={tabRef}
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={`group relative flex items-center gap-1 px-3 h-8 text-xs font-medium transition-colors shrink-0 cursor-pointer ${
        active ? "text-foreground" : "text-muted-foreground hover:text-foreground/80"
      }`}
    >
      <span className="truncate max-w-[200px]">{label}</span>
      {onClose && (
        <span
          role="button"
          tabIndex={0}
          aria-label={`Close ${label} tab`}
          onClick={(e) => {
            e.stopPropagation();
            onClose();
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.stopPropagation();
              e.preventDefault();
              onClose();
            }
          }}
          className={`ml-0.5 rounded-sm p-0.5 hover:bg-muted transition-all ${
            active ? "opacity-100" : "opacity-0 group-hover:opacity-100"
          }`}
        >
          <XIcon className="size-2.5" />
        </span>
      )}
      {active && (
        <div className="absolute bottom-0 left-2 right-2 h-0.5 bg-foreground rounded-full" />
      )}
    </button>
  );
}

function truncateTask(task: string, maxLen = 30): string {
  const trimmed = task.trim();
  if (trimmed.length <= maxLen) return trimmed;
  const boundary = trimmed.lastIndexOf(" ", maxLen);
  return (boundary > 10 ? trimmed.slice(0, boundary) : trimmed.slice(0, maxLen)).trim() + "...";
}

export function MiddlePanelTabs({
  sessionId,
  transcriptContent,
  summaryContent,
  agentContent,
  summaryState,
  newAgentMode,
  openAgentIds,
  agentTabTitles,
  selectedAgentId,
  agentSelectionNonce,
  onSelectAgent,
  onCloseAgent,
  onCloseNewAgent,
  onGenerateSummary,
  agents,
}: MiddlePanelTabsProps) {
  const [activeTabBySession, setActiveTabBySession] = useState<Record<string, TabId>>({});
  const prevSummaryKindRef = useRef(summaryState.kind);
  const tabRefs = useRef<Record<TabId, HTMLButtonElement | null>>({
    transcript: null,
    summary: null,
    "new-agent": null,
  });
  const sessionTabKey = sessionId ?? EMPTY_SESSION_TAB_KEY;
  const activeTab = activeTabBySession[sessionTabKey] ?? "transcript";

  const setActiveTab = (tab: TabId) => {
    setActiveTabBySession((prev) => ({ ...prev, [sessionTabKey]: tab }));
  };

  const showAgentTabs = openAgentIds.length > 0;
  const agentById = new Map((agents ?? []).map((agent) => [agent.id, agent]));

  let validTab = activeTab;
  if (activeTab === "new-agent" && !newAgentMode) {
    validTab = selectedAgentId ? getAgentTabId(selectedAgentId) : "transcript";
  } else if (isAgentTab(activeTab) && !openAgentIds.some((agentId) => getAgentTabId(agentId) === activeTab)) {
    validTab = selectedAgentId ? getAgentTabId(selectedAgentId) : (newAgentMode ? "new-agent" : "transcript");
  }

  useEffect(() => {
    if (validTab !== activeTab) {
      setActiveTab(validTab);
    }
  }, [activeTab, validTab, sessionTabKey]);

  useEffect(() => {
    if (newAgentMode) { setActiveTab("new-agent"); return; }
    if (selectedAgentId) { setActiveTab(getAgentTabId(selectedAgentId)); }
  }, [agentSelectionNonce, selectedAgentId, newAgentMode, sessionTabKey]);

  useEffect(() => {
    if (prevSummaryKindRef.current === "idle" && summaryState.kind !== "idle") setActiveTab("summary");
    prevSummaryKindRef.current = summaryState.kind;
  }, [summaryState.kind, sessionTabKey]);

  useEffect(() => {
    const activeTabElement = tabRefs.current[validTab];
    if (!activeTabElement) return;

    const frame = window.requestAnimationFrame(() => {
      activeTabElement.scrollIntoView({
        behavior: "smooth",
        inline: "center",
        block: "nearest",
      });
    });

    return () => window.cancelAnimationFrame(frame);
  }, [validTab, sessionTabKey, openAgentIds, agentSelectionNonce]);

  return (
    <main className="flex-1 flex flex-col min-h-0 min-w-0 relative">
      <div
        role="tablist"
        className="no-scrollbar shrink-0 flex items-center h-9 border-b border-border bg-background px-1 gap-0.5 overflow-x-auto"
      >
        <TabButton
          tabRef={{
            get current() {
              return tabRefs.current.transcript;
            },
            set current(value: HTMLButtonElement | null) {
              tabRefs.current.transcript = value;
            },
          }}
          active={validTab === "transcript"}
          label="Transcript"
          onClick={() => setActiveTab("transcript")}
        />
        <TabButton
          tabRef={{
            get current() {
              return tabRefs.current.summary;
            },
            set current(value: HTMLButtonElement | null) {
              tabRefs.current.summary = value;
            },
          }}
          active={validTab === "summary"}
          label="Summary"
          onClick={() => {
            if (summaryState.kind === "idle" && onGenerateSummary) {
              onGenerateSummary();
            }
            setActiveTab("summary");
          }}
        />
        {newAgentMode && (
          <TabButton
            tabRef={{
              get current() {
                return tabRefs.current["new-agent"];
              },
              set current(value: HTMLButtonElement | null) {
                tabRefs.current["new-agent"] = value;
              },
            }}
            active={validTab === "new-agent"}
            label="New Agent"
            onClick={() => setActiveTab("new-agent")}
            onClose={onCloseNewAgent}
          />
        )}
        {showAgentTabs && openAgentIds.map((agentId) => {
          const agent = agentById.get(agentId);
          const label = agent
            ? truncateTask(agent.task)
            : truncateTask(agentTabTitles?.[agentId] ?? "Agent");
          const tabId = getAgentTabId(agentId);
          return (
            <TabButton
              key={agentId}
              tabRef={{
                get current() {
                  return tabRefs.current[tabId];
                },
                set current(value: HTMLButtonElement | null) {
                  tabRefs.current[tabId] = value;
                },
              }}
              active={validTab === tabId}
              label={label}
              onClick={() => {
                onSelectAgent(agentId);
                setActiveTab(tabId);
              }}
              onClose={() => onCloseAgent(agentId)}
            />
          );
        })}
      </div>

      <div className={`flex-1 flex flex-col min-h-0 ${validTab === "transcript" ? "" : "hidden"}`}>
        {transcriptContent}
      </div>

      <div className={`flex-1 flex flex-col min-h-0 ${validTab === "summary" ? "" : "hidden"}`}>
        {summaryContent}
      </div>

      {(newAgentMode || showAgentTabs) && (validTab === "new-agent" || isAgentTab(validTab)) && (
        <div className="flex-1 flex flex-col min-h-0">
          {agentContent}
        </div>
      )}
    </main>
  );
}
