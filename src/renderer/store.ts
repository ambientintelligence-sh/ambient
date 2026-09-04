import { create } from 'zustand';
import type { AuthState } from '@/shared/auth';
import type { BrowserState } from '@/shared/browser';
import type { LocalContextState } from '@/shared/local-context';
import type { WorkEvent, WorkJob, WorkerReply } from '@/shared/router';
import type { NetworkState } from '@/shared/sandbox';
import type { SessionSnapshot, SessionSummary, TimelineItem } from '@/shared/session';
import type { PrimaryAgent, Worker, WorkerEvent } from '@/shared/worker';
import type { WorkspaceState } from '@/shared/workspace';

export type Page = 'timeline' | 'agents';

type AppState = {
  initialized: boolean;
  page: Page;
  setupOpen: boolean;
  auth: AuthState | null;
  workspace: WorkspaceState;
  browser: BrowserState;
  network: NetworkState;
  location: LocalContextState | null;
  session: SessionSnapshot['session'] | null;
  sessions: readonly SessionSummary[];
  jobs: readonly WorkJob[];
  replies: readonly WorkerReply[];
  timelineItems: readonly TimelineItem[];
  workers: readonly Worker[];
  primaryAgent: PrimaryAgent | null;
  error: string | null;
  initialize: () => void;
  setPage: (page: Page) => void;
  setSetupOpen: (open: boolean) => void;
  setAuth: (auth: AuthState) => void;
  chooseWorkspace: () => void;
  setBrowserVisible: (visible: boolean) => void;
  setNetworkEnabled: (enabled: boolean) => void;
  setLocation: (location: LocalContextState) => void;
  dismissDisplay: (id: string) => void;
  createSession: () => void;
  selectSession: (id: string) => void;
};

const bridge = window.ambient;
const workerKey = (worker: Worker) => `${worker.parentJobId}:${worker.name}`;

const upsertWorker = (items: readonly Worker[], worker: Worker) => {
  const key = workerKey(worker);
  const index = items.findIndex((item) => workerKey(item) === key);
  if (index === -1) return [...items, worker];
  return items.map((item, itemIndex) => itemIndex === index ? worker : item);
};

const applyWorkEvent = (state: AppState, event: WorkEvent): Partial<AppState> => {
  if (event.sessionId !== state.session?.id) return {};
  if (event.kind === 'job') {
    const index = state.jobs.findIndex((job) => job.id === event.job.id);
    const title = event.job.request.replace(/\s+/g, ' ').trim().slice(0, 64) || 'New session';
    const session = state.session?.title === 'New session' ? { ...state.session, title, updatedAt: Date.now() } : state.session;
    return {
      session,
      sessions: session ? state.sessions.map((item) => item.id === session.id
        ? { ...item, title: session.title, updatedAt: session.updatedAt, jobCount: index === -1 ? item.jobCount + 1 : item.jobCount }
        : item) : state.sessions,
      jobs: index === -1 ? [...state.jobs, event.job] : state.jobs.map((job) => job.id === event.job.id ? event.job : job),
    };
  }
  if (event.kind === 'voice-message') {
    const index = state.replies.findIndex((reply) => reply.id === event.message.id);
    return { replies: index === -1
      ? [...state.replies, event.message]
      : state.replies.map((reply) => reply.id === event.message.id ? event.message : reply) };
  }
  const index = state.timelineItems.findIndex((item) => item.display.id === event.display.id);
  const item: TimelineItem = { job: event.job, display: event.display, dismissed: false };
  return { timelineItems: index === -1
    ? [...state.timelineItems, item]
    : state.timelineItems.map((current, itemIndex) => itemIndex === index ? { ...item, dismissed: current.dismissed } : current) };
};

const snapshotState = (snapshot: SessionSnapshot): Partial<AppState> => ({
  session: snapshot.session,
  jobs: snapshot.jobs,
  replies: snapshot.replies,
  timelineItems: snapshot.timelineItems,
  workers: snapshot.workers,
  primaryAgent: snapshot.primaryAgent,
});

let initializationStarted = false;

export const useAppStore = create<AppState>()((set, get) => ({
  initialized: false,
  page: 'timeline',
  setupOpen: false,
  auth: null,
  workspace: { path: null, name: null },
  browser: { mode: 'headless', available: false },
  network: { enabled: false },
  location: null,
  session: null,
  sessions: [],
  jobs: [],
  replies: [],
  timelineItems: [],
  workers: [],
  primaryAgent: null,
  error: null,
  initialize: () => {
    if (!bridge || initializationStarted) return;
    initializationStarted = true;
    const workEvents: WorkEvent[] = [];
    const workerEvents: WorkerEvent[] = [];
    const primaryAgentEvents: PrimaryAgent[] = [];
    let hydrating = true;
    bridge.onWorkEvent((event) => {
      if (hydrating) workEvents.push(event);
      else set((state) => applyWorkEvent(state, event));
    });
    bridge.onWorkerEvent((event) => {
      if (hydrating) workerEvents.push(event);
      else set((state) => event.sessionId === state.session?.id ? { workers: upsertWorker(state.workers, event.worker) } : {});
    });
    bridge.onPrimaryAgentEvent((event) => {
      if (hydrating) primaryAgentEvents.push(event.agent);
      else set((state) => event.sessionId === state.session?.id ? { primaryAgent: event.agent } : {});
    });
    bridge.onSessionEvent((event) => {
      if (event.kind === 'selected') set({ ...snapshotState(event.snapshot), page: 'timeline' });
      else set((state) => ({ timelineItems: state.timelineItems.map((item) =>
        item.display.id === event.displayId ? { ...item, dismissed: true } : item) }));
    });
    bridge.onWorkspaceChanged((workspace) => set({ workspace }));
    bridge.onNetworkChanged((network) => set({ network }));
    bridge.onLocationChanged((location) => set({ location }));
    bridge.onAuthEvent((event) => {
      if (event.type === 'complete') void bridge.getAuthState().then((auth) => set({ auth }));
    });
    void Promise.all([
      bridge.getSession(),
      bridge.listSessions(),
      bridge.getAuthState(),
      bridge.getWorkspace(),
      bridge.getBrowserState(),
      bridge.getNetworkState(),
      bridge.getLocationState(),
    ]).then(([snapshot, sessions, auth, workspace, browser, network, location]) => {
      set({
        ...snapshotState(snapshot),
        sessions,
        auth,
        workspace,
        browser,
        network,
        location,
        setupOpen: !auth.selection,
      });
      hydrating = false;
      for (const event of workEvents) set((state) => applyWorkEvent(state, event));
      for (const event of workerEvents) {
        set((state) => event.sessionId === state.session?.id ? { workers: upsertWorker(state.workers, event.worker) } : {});
      }
      for (const agent of primaryAgentEvents) {
        set((state) => agent.sessionId === state.session?.id ? { primaryAgent: agent } : {});
      }
      set({ initialized: true });
    }).catch((cause: unknown) => {
      hydrating = false;
      set({ initialized: true, error: cause instanceof Error ? cause.message : String(cause) });
    });
  },
  setPage: (page) => set({ page }),
  setSetupOpen: (setupOpen) => set({ setupOpen }),
  setAuth: (auth) => set({ auth }),
  chooseWorkspace: () => {
    void bridge?.selectWorkspace().then((workspace) => set({ workspace })).catch((cause: unknown) => {
      set({ error: cause instanceof Error ? cause.message : String(cause) });
    });
  },
  setBrowserVisible: (visible) => {
    void bridge?.setBrowserMode(visible ? 'visible' : 'headless').then((browser) => set({ browser })).catch((cause: unknown) => {
      set({ error: cause instanceof Error ? cause.message : String(cause) });
    });
  },
  setNetworkEnabled: (enabled) => {
    void bridge?.setNetworkEnabled(enabled).then((network) => set({ network })).catch((cause: unknown) => {
      set({ error: cause instanceof Error ? cause.message : String(cause) });
    });
  },
  setLocation: (location) => set({ location }),
  dismissDisplay: (id) => {
    const previous = get().timelineItems;
    set({ timelineItems: previous.map((item) => item.display.id === id ? { ...item, dismissed: true } : item) });
    void bridge?.dismissDisplay(id).catch((cause: unknown) => {
      set({ timelineItems: previous, error: cause instanceof Error ? cause.message : String(cause) });
    });
  },
  createSession: () => {
    void bridge?.createSession().then(async (snapshot) => {
      const sessions = await bridge.listSessions();
      set({ ...snapshotState(snapshot), sessions, page: 'timeline' });
    }).catch((cause: unknown) => set({ error: cause instanceof Error ? cause.message : String(cause) }));
  },
  selectSession: (id) => {
    if (id === get().session?.id) return;
    void bridge?.selectSession(id).then((snapshot) => set({ ...snapshotState(snapshot), page: 'timeline' }))
      .catch((cause: unknown) => set({ error: cause instanceof Error ? cause.message : String(cause) }));
  },
}));
