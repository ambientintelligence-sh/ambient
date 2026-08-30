import type { TimelineDisplay } from './worker';

export type WorkStatus = 'accepted' | 'routing' | 'working' | 'complete' | 'failed' | 'cancelled';

export type WorkJob = Readonly<{
  id: string;
  request: string;
  status: WorkStatus;
  childWorkers: readonly string[];
  createdAt: number;
  result: string | null;
  error: string | null;
}>;

export type RouterVoiceMessage = Readonly<{
  id: string;
  jobId: string;
  kind: 'progress' | 'result' | 'error' | 'clarification';
  text: string;
  displayTitle: string | null;
}>;

export type RouterEvent =
  | Readonly<{ kind: 'job'; job: WorkJob }>
  | Readonly<{ kind: 'voice-message'; message: RouterVoiceMessage }>
  | Readonly<{ kind: 'display'; job: WorkJob; display: TimelineDisplay }>;

export type DispatchWorkResult = Readonly<{ jobId: string; status: 'accepted' }>;

export type CancelWorkResult =
  | Readonly<{ ok: true; jobId: string; status: 'cancelled' }>
  | Readonly<{ ok: false; error: string }>;
