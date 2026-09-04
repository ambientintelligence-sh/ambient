import type { WorkJob, WorkerReply } from './router';
import type { PrimaryAgent, TimelineDisplay, Worker } from './worker';

export type AmbientSession = Readonly<{
  id: string;
  title: string;
  workspace: string | null;
  createdAt: number;
  updatedAt: number;
}>;

export type TimelineItem = Readonly<{
  job: WorkJob;
  display: TimelineDisplay;
  dismissed: boolean;
}>;

export type SessionSnapshot = Readonly<{
  session: AmbientSession;
  jobs: readonly WorkJob[];
  replies: readonly WorkerReply[];
  timelineItems: readonly TimelineItem[];
  workers: readonly Worker[];
  primaryAgent: PrimaryAgent | null;
}>;

export type SessionSummary = AmbientSession & Readonly<{
  jobCount: number;
}>;

export type SessionEvent =
  | Readonly<{ kind: 'selected'; snapshot: SessionSnapshot }>
  | Readonly<{ kind: 'display-dismissed'; displayId: string }>;
