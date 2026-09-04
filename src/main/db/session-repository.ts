import { randomUUID } from 'node:crypto';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import type { WorkJob, WorkerReply } from '../../shared/router';
import type { AmbientSession, SessionSnapshot, SessionSummary } from '../../shared/session';
import type { PrimaryAgent, TimelineDisplay, Worker } from '../../shared/worker';
import type { AmbientDatabase } from './index';
import { displays, jobs, primaryAgents, replies, sessions, workers } from './schema.ts';

const DEFAULT_TITLE = 'New session';
const titleFromRequest = (request: string) => request.replace(/\s+/g, ' ').trim().slice(0, 64) || DEFAULT_TITLE;

export type SessionRecord = AmbientSession & Readonly<{ piSessionFile: string | null }>;

export function createSessionRepository(db: AmbientDatabase) {
  const toSession = (row: typeof sessions.$inferSelect): SessionRecord => ({
    id: row.id,
    title: row.title,
    workspace: row.workspace,
    piSessionFile: row.piSessionFile,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });

  const getSession = (id: string): SessionRecord | null => {
    const row = db.select().from(sessions).where(eq(sessions.id, id)).get();
    return row ? toSession(row) : null;
  };

  const createSession = (workspace: string | null): SessionRecord => {
    const now = Date.now();
    const row = {
      id: randomUUID(),
      title: DEFAULT_TITLE,
      workspace,
      piSessionFile: null,
      createdAt: now,
      updatedAt: now,
    };
    db.insert(sessions).values(row).run();
    return toSession(row);
  };

  const latestOrCreate = (workspace: string | null): SessionRecord => {
    const row = db.select().from(sessions).orderBy(desc(sessions.updatedAt)).limit(1).get();
    return row ? toSession(row) : createSession(workspace);
  };

  const touch = (sessionId: string) => {
    db.update(sessions).set({ updatedAt: Date.now() }).where(eq(sessions.id, sessionId)).run();
  };

  const saveJob = (sessionId: string, job: WorkJob) => {
    db.transaction((tx) => {
      tx.insert(jobs).values({
        id: job.id,
        sessionId,
        request: job.request,
        status: job.status,
        childWorkers: job.childWorkers,
        networkEnabled: job.networkEnabled,
        createdAt: job.createdAt,
        result: job.result,
        error: job.error,
      }).onConflictDoUpdate({
        target: jobs.id,
        set: {
          request: job.request,
          status: job.status,
          childWorkers: job.childWorkers,
          result: job.result,
          error: job.error,
        },
      }).run();
      const current = tx.select().from(sessions).where(eq(sessions.id, sessionId)).get();
      tx.update(sessions).set({
        title: current?.title === DEFAULT_TITLE ? titleFromRequest(job.request) : current?.title,
        updatedAt: Date.now(),
      }).where(eq(sessions.id, sessionId)).run();
    });
  };

  const saveReply = (sessionId: string, reply: WorkerReply) => {
    db.insert(replies).values({
      id: reply.id,
      sessionId,
      jobId: reply.jobId,
      kind: reply.kind,
      body: reply.text,
      displayTitle: reply.displayTitle,
      createdAt: reply.createdAt,
    }).onConflictDoNothing().run();
    touch(sessionId);
  };

  const saveDisplay = (sessionId: string, jobId: string, display: TimelineDisplay) => {
    db.insert(displays).values({
      id: display.id,
      sessionId,
      jobId,
      widgetId: display.widgetId,
      title: display.title,
      format: display.format,
      content: display.content,
      alt: display.alt,
      caption: display.caption,
      links: display.links,
      createdAt: display.createdAt,
      dismissed: false,
    }).onConflictDoUpdate({
      target: displays.id,
      set: {
        title: display.title,
        format: display.format,
        content: display.content,
        alt: display.alt,
        caption: display.caption,
        links: display.links,
      },
    }).run();
    touch(sessionId);
  };

  const saveWorker = (sessionId: string, worker: Worker) => {
    db.insert(workers).values({
      sessionId,
      name: worker.name,
      task: worker.task,
      parentJobId: worker.parentJobId,
      status: worker.status,
      startedAt: worker.startedAt,
      stops: worker.stops,
      updates: worker.updates,
      artifacts: worker.artifacts,
      piSessionId: worker.piSessionId,
      piSessionFile: worker.piSessionFile,
      summary: worker.summary,
      error: worker.error,
    }).onConflictDoUpdate({
      target: [workers.parentJobId, workers.name],
      set: {
        status: worker.status,
        stops: worker.stops,
        updates: worker.updates,
        artifacts: worker.artifacts,
        piSessionId: worker.piSessionId,
        piSessionFile: worker.piSessionFile,
        summary: worker.summary,
        error: worker.error,
      },
    }).run();
    touch(sessionId);
  };

  const snapshot = (sessionId: string): SessionSnapshot => {
    const session = getSession(sessionId);
    if (!session) throw new Error(`Unknown session ${sessionId}`);
    const jobRows = db.select().from(jobs).where(eq(jobs.sessionId, sessionId)).orderBy(asc(jobs.createdAt)).all();
    const jobItems: WorkJob[] = jobRows.map((row) => ({
      id: row.id,
      request: row.request,
      status: row.status,
      childWorkers: row.childWorkers,
      networkEnabled: row.networkEnabled,
      createdAt: row.createdAt,
      result: row.result,
      error: row.error,
    }));
    const jobsById = new Map(jobItems.map((job) => [job.id, job]));
    const replyItems: WorkerReply[] = db.select().from(replies)
      .where(eq(replies.sessionId, sessionId)).orderBy(asc(replies.createdAt)).all().map((row) => ({
        id: row.id,
        jobId: row.jobId,
        kind: row.kind,
        text: row.body,
        displayTitle: row.displayTitle,
        createdAt: row.createdAt,
      }));
    const timelineItems = db.select().from(displays)
      .where(eq(displays.sessionId, sessionId)).orderBy(asc(displays.createdAt)).all().flatMap((row) => {
        const job = jobsById.get(row.jobId);
        if (!job) return [];
        return [{
          job,
          dismissed: row.dismissed,
          display: {
            id: row.id,
            widgetId: row.widgetId,
            title: row.title,
            format: row.format,
            content: row.content,
            alt: row.alt,
            caption: row.caption,
            links: row.links,
            createdAt: row.createdAt,
          },
        }];
      });
    const workerItems: Worker[] = db.select().from(workers)
      .where(eq(workers.sessionId, sessionId)).all().map((row) => ({
        name: row.name,
        task: row.task,
        parentJobId: row.parentJobId,
        status: row.status,
        startedAt: row.startedAt,
        stops: row.stops,
        updates: row.updates,
        artifacts: row.artifacts,
        piSessionId: row.piSessionId,
        piSessionFile: row.piSessionFile,
        summary: row.summary,
        error: row.error,
      }));
    const { piSessionFile: _piSessionFile, ...publicSession } = session;
    const primaryRow = db.select().from(primaryAgents).where(eq(primaryAgents.sessionId, sessionId)).get();
    const primaryAgent: PrimaryAgent | null = primaryRow ? {
      sessionId: primaryRow.sessionId,
      name: 'PRIMARY',
      status: primaryRow.status,
      currentJobId: primaryRow.currentJobId,
      currentTask: primaryRow.currentTask,
      startedAt: primaryRow.startedAt,
      stops: primaryRow.stops,
      updates: primaryRow.updates,
      artifacts: primaryRow.artifacts,
      piSessionId: primaryRow.piSessionId,
      piSessionFile: primaryRow.piSessionFile,
      error: primaryRow.error,
    } : null;
    return { session: publicSession, jobs: jobItems, replies: replyItems, timelineItems, workers: workerItems, primaryAgent };
  };

  return {
    getSession,
    createSession,
    latestOrCreate,
    snapshot,
    saveJob,
    saveReply,
    saveDisplay,
    saveWorker,
    savePrimaryAgent(agent: PrimaryAgent) {
      db.insert(primaryAgents).values(agent).onConflictDoUpdate({
        target: primaryAgents.sessionId,
        set: {
          status: agent.status,
          currentJobId: agent.currentJobId,
          currentTask: agent.currentTask,
          stops: agent.stops,
          updates: agent.updates,
          artifacts: agent.artifacts,
          piSessionId: agent.piSessionId,
          piSessionFile: agent.piSessionFile,
          error: agent.error,
        },
      }).run();
      touch(agent.sessionId);
    },
    setPiSessionFile(sessionId: string, piSessionFile: string) {
      db.update(sessions).set({ piSessionFile, updatedAt: Date.now() }).where(eq(sessions.id, sessionId)).run();
    },
    setWorkspace(sessionId: string, workspace: string | null) {
      db.update(sessions).set({ workspace, updatedAt: Date.now() }).where(eq(sessions.id, sessionId)).run();
    },
    dismissDisplay(sessionId: string, displayId: string) {
      db.update(displays).set({ dismissed: true }).where(and(eq(displays.sessionId, sessionId), eq(displays.id, displayId))).run();
      touch(sessionId);
    },
    list(): readonly SessionSummary[] {
      return db.select({
        id: sessions.id,
        title: sessions.title,
        workspace: sessions.workspace,
        createdAt: sessions.createdAt,
        updatedAt: sessions.updatedAt,
        jobCount: sql<number>`count(${jobs.id})`,
      }).from(sessions).leftJoin(jobs, eq(jobs.sessionId, sessions.id))
        .groupBy(sessions.id).orderBy(desc(sessions.updatedAt)).all();
    },
    reconcileInterrupted(sessionId: string, reason = 'Interrupted by application restart.') {
      const interruptedJobs = db.select({ id: jobs.id }).from(jobs)
        .where(and(eq(jobs.sessionId, sessionId), inArray(jobs.status, ['accepted', 'routing', 'working']))).all();
      if (interruptedJobs.length > 0) {
        const ids = interruptedJobs.map(({ id }) => id);
        db.transaction((tx) => {
          tx.update(jobs).set({ status: 'failed', error: reason }).where(inArray(jobs.id, ids)).run();
          tx.update(workers).set({ status: 'failed', error: reason })
            .where(and(eq(workers.sessionId, sessionId), inArray(workers.status, ['queued', 'running']))).run();
        });
      }
      const primary = db.select().from(primaryAgents).where(eq(primaryAgents.sessionId, sessionId)).get();
      if (primary?.status === 'running' || primary?.status === 'initializing') {
        db.update(primaryAgents).set({
          status: 'idle',
          currentJobId: null,
          currentTask: null,
          error: reason,
        }).where(eq(primaryAgents.sessionId, sessionId)).run();
      }
    },
  };
}

export type SessionRepository = ReturnType<typeof createSessionRepository>;
