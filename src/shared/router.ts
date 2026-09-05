import type { TimelineDisplay } from './worker';

export type WorkStatus = 'accepted' | 'routing' | 'working' | 'complete' | 'failed' | 'cancelled';

export type WorkJob = Readonly<{
  id: string;
  request: string;
  status: WorkStatus;
  childWorkers: readonly string[];
  networkEnabled: boolean;
  createdAt: number;
  result: string | null;
  error: string | null;
}>;

export type WorkerReply = Readonly<{
  id: string;
  jobId: string;
  kind: 'progress' | 'result' | 'error' | 'clarification';
  text: string;
  displayTitle: string | null;
  createdAt: number;
}>;

export type WorkEvent =
  | Readonly<{ kind: 'job'; sessionId: string; job: WorkJob }>
  | Readonly<{ kind: 'voice-message'; sessionId: string; message: WorkerReply }>
  | Readonly<{ kind: 'display-removed'; sessionId: string; displayId: string }>
  | Readonly<{ kind: 'display'; sessionId: string; job: WorkJob; display: TimelineDisplay }>;

export type SendMessageResult = Readonly<{ messageId: string; status: 'sent' }>;

export type CancelWorkResult =
  | Readonly<{ ok: true; jobId: string; status: 'cancelled' }>
  | Readonly<{ ok: false; error: string }>;

export const shouldSpeakReply = (_reply: WorkerReply) => true;
