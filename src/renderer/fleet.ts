/**
 * Mock delegation model. No tools are wired to the realtime session yet, so the
 * fleet is simulated — but every transition is driven by a real session event,
 * and the reducer is pure so swapping in live tool calls is a one-file change.
 */

export type AgentTint = 'link' | 'live' | 'warn' | 'deep';

export type AgentPhase = 'idle' | 'briefed' | 'working' | 'reporting' | 'done' | 'blocked';

export type Agent = Readonly<{
  id: string;
  name: string;
  role: string;
  tint: AgentTint;
  phase: AgentPhase;
  tool: string | null;
  step: number;
}>;

export type ToolCall = Readonly<{
  id: number;
  agentId: string;
  tool: string;
  tint: AgentTint;
  status: 'running' | 'ok' | 'failed';
}>;

export type FleetState = Readonly<{
  agents: readonly Agent[];
  calls: readonly ToolCall[];
  nextCallId: number;
}>;

const TOOLBOX: Readonly<Record<string, readonly string[]>> = {
  research: ['web.search', 'page.read', 'source.rank'],
  calendar: ['cal.find_slot', 'cal.hold', 'cal.invite'],
  inbox: ['mail.scan', 'thread.summarize', 'mail.draft'],
  docs: ['doc.open', 'doc.diff', 'doc.write'],
};

const ROSTER: readonly Agent[] = [
  { id: 'research', name: 'RESEARCH·01', role: 'web + synthesis', tint: 'link', phase: 'idle', tool: null, step: 0 },
  { id: 'calendar', name: 'CALENDAR·02', role: 'scheduling', tint: 'live', phase: 'idle', tool: null, step: 0 },
  { id: 'inbox', name: 'INBOX·03', role: 'mail triage', tint: 'warn', phase: 'idle', tool: null, step: 0 },
  { id: 'docs', name: 'DOCS·04', role: 'writing', tint: 'deep', phase: 'idle', tool: null, step: 0 },
];

export const INITIAL_FLEET: FleetState = { agents: ROSTER, calls: [], nextCallId: 1 };

export type FleetEvent =
  /** The orchestrator started a turn — hand work to one agent. `roll` is 0..1. */
  | { kind: 'delegate'; roll: number }
  /** A tick of simulated progress. */
  | { kind: 'advance'; roll: number }
  /** The turn finished — everything mid-flight reports back. */
  | { kind: 'settle' }
  | { kind: 'reset' };

const isBusy = (agent: Agent) => agent.phase === 'briefed' || agent.phase === 'working';

const startCall = (id: number, agent: Agent, tool: string | null): ToolCall => ({
  id,
  agentId: agent.id,
  tool: tool ?? '—',
  tint: agent.tint,
  status: 'running',
});

const toolFor = (agentId: string, step: number) => {
  const tools = TOOLBOX[agentId] ?? [];
  return tools[Math.min(step, tools.length - 1)] ?? null;
};

function delegate(state: FleetState, roll: number): FleetState {
  const idle = state.agents.filter((agent) => !isBusy(agent));
  if (idle.length === 0) return state;

  const chosen = idle[Math.floor(roll * idle.length) % idle.length];
  const tool = toolFor(chosen.id, 0);

  return {
    agents: state.agents.map((agent) =>
      agent.id === chosen.id ? { ...agent, phase: 'briefed', tool, step: 0 } : agent,
    ),
    calls: [startCall(state.nextCallId, chosen, tool), ...state.calls].slice(0, 6),
    nextCallId: state.nextCallId + 1,
  };
}

function advance(state: FleetState, roll: number): FleetState {
  let calls: readonly ToolCall[] = state.calls;
  let nextCallId = state.nextCallId;

  const agents = state.agents.map((agent): Agent => {
    if (agent.phase === 'briefed') return { ...agent, phase: 'working' };
    if (agent.phase !== 'working') return agent;

    const tools = TOOLBOX[agent.id] ?? [];
    const step = agent.step + 1;

    calls = calls.map((call): ToolCall =>
      call.agentId === agent.id && call.status === 'running' ? { ...call, status: 'ok' } : call,
    );

    if (step >= tools.length) return { ...agent, phase: 'reporting', tool: null, step };

    const tool = toolFor(agent.id, step);
    calls = [startCall(nextCallId, agent, tool), ...calls].slice(0, 6);
    nextCallId += 1;

    return { ...agent, phase: 'working', tool, step };
  });

  // A rare stall keeps the panel honest about failure being a real state.
  const stall = roll > 0.93;
  return {
    agents: stall
      ? agents.map((agent, index) => (index === agents.length - 1 && agent.phase === 'working' ? { ...agent, phase: 'blocked' } : agent))
      : agents,
    calls,
    nextCallId,
  };
}

function settle(state: FleetState): FleetState {
  return {
    ...state,
    agents: state.agents.map((agent) =>
      agent.phase === 'reporting' || agent.phase === 'working' || agent.phase === 'briefed'
        ? { ...agent, phase: 'done', tool: null }
        : agent,
    ),
    calls: state.calls.map((call): ToolCall => (call.status === 'running' ? { ...call, status: 'ok' } : call)),
  };
}

export function reduceFleet(state: FleetState, event: FleetEvent): FleetState {
  switch (event.kind) {
    case 'delegate':
      return delegate(state, event.roll);
    case 'advance':
      return advance(state, event.roll);
    case 'settle':
      return settle(state);
    case 'reset':
      return INITIAL_FLEET;
  }
}

export const activeAgent = (state: FleetState): Agent | null =>
  state.agents.find(isBusy) ?? state.agents.find((agent) => agent.phase === 'reporting') ?? null;

export const activeTool = (state: FleetState): string | null =>
  state.calls.find((call) => call.status === 'running')?.tool ?? null;
