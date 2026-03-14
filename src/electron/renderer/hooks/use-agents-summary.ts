import { useState, useEffect, useRef } from "react";
import type { Agent, AgentsSummary } from "@core/types";

export type AgentsSummaryState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "ready"; summary: AgentsSummary }
  | { kind: "error"; message: string };

export function useAgentsSummary(agents: Agent[], sessionActive = true) {
  const [state, setState] = useState<AgentsSummaryState>({ kind: "idle" });
  const autoTriggeredRef = useRef(false);

  useEffect(() => {
    const cleanups = [
      window.electronAPI.onAgentsSummaryReady((s) => setState({ kind: "ready", summary: s })),
      window.electronAPI.onAgentsSummaryError((m) => setState({ kind: "error", message: m })),
    ];
    return () => cleanups.forEach((fn) => fn());
  }, []);

  // Auto-trigger: ≥3 agents all terminal, only when session is actively recording
  useEffect(() => {
    if (!sessionActive || autoTriggeredRef.current || state.kind !== "idle") return;
    const allTerminal =
      agents.length >= 3 &&
      agents.every((a) => a.status === "completed" || a.status === "failed");
    if (allTerminal) {
      autoTriggeredRef.current = true;
      setState({ kind: "loading" });
      window.electronAPI.generateAgentsSummary().then((res) => {
        if (!res.ok) setState({ kind: "error", message: res.error ?? "Failed to generate debrief" });
      });
    }
  }, [agents, state.kind, sessionActive]);

  const generate = () => {
    setState({ kind: "loading" });
    window.electronAPI.generateAgentsSummary().then((res) => {
      if (!res.ok) setState({ kind: "error", message: res.error ?? "Failed to generate debrief" });
    });
  };

  // Used by the parent to seed a persisted summary for past sessions
  const preload = (summary: AgentsSummary) => {
    setState({ kind: "ready", summary });
    autoTriggeredRef.current = true; // prevent auto-trigger from overwriting
  };

  const canGenerate =
    agents.length > 0 && agents.every((a) => a.status !== "running");

  return { state, generate, canGenerate, preload };
}
