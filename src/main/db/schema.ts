import { index, integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import type { WorkStatus, WorkerReply } from '../../shared/router';
import type { AgentArtifact, PrimaryAgentStatus, TimelineDisplay, WorkerStatus, WorkerStop, WorkerUpdate } from '../../shared/worker';

export const sessions = sqliteTable('sessions', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  workspace: text('workspace'),
  piSessionFile: text('pi_session_file'),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
}, (table) => [index('sessions_updated_at_idx').on(table.updatedAt)]);

export const jobs = sqliteTable('jobs', {
  id: text('id').primaryKey(),
  sessionId: text('session_id').notNull().references(() => sessions.id, { onDelete: 'cascade' }),
  request: text('request').notNull(),
  status: text('status').$type<WorkStatus>().notNull(),
  childWorkers: text('child_workers', { mode: 'json' }).$type<readonly string[]>().notNull(),
  networkEnabled: integer('network_enabled', { mode: 'boolean' }).notNull(),
  createdAt: integer('created_at').notNull(),
  result: text('result'),
  error: text('error'),
}, (table) => [index('jobs_session_created_idx').on(table.sessionId, table.createdAt)]);

export const replies = sqliteTable('replies', {
  id: text('id').primaryKey(),
  sessionId: text('session_id').notNull().references(() => sessions.id, { onDelete: 'cascade' }),
  jobId: text('job_id').notNull().references(() => jobs.id, { onDelete: 'cascade' }),
  kind: text('kind').$type<WorkerReply['kind']>().notNull(),
  body: text('body').notNull(),
  displayTitle: text('display_title'),
  createdAt: integer('created_at').notNull(),
}, (table) => [index('replies_session_created_idx').on(table.sessionId, table.createdAt)]);

export const displays = sqliteTable('displays', {
  id: text('id').primaryKey(),
  sessionId: text('session_id').notNull().references(() => sessions.id, { onDelete: 'cascade' }),
  jobId: text('job_id').notNull().references(() => jobs.id, { onDelete: 'cascade' }),
  widgetId: text('widget_id'),
  title: text('title').notNull(),
  format: text('format').$type<TimelineDisplay['format']>().notNull(),
  content: text('content').notNull(),
  alt: text('alt'),
  caption: text('caption'),
  links: text('links', { mode: 'json' }).$type<TimelineDisplay['links']>().notNull(),
  createdAt: integer('created_at').notNull(),
  dismissed: integer('dismissed', { mode: 'boolean' }).notNull().default(false),
}, (table) => [
  index('displays_session_created_idx').on(table.sessionId, table.createdAt),
  index('displays_job_widget_idx').on(table.jobId, table.widgetId),
]);

export const workers = sqliteTable('workers', {
  sessionId: text('session_id').notNull().references(() => sessions.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  task: text('task').notNull(),
  parentJobId: text('parent_job_id').notNull().references(() => jobs.id, { onDelete: 'cascade' }),
  status: text('status').$type<WorkerStatus>().notNull(),
  startedAt: text('started_at').notNull(),
  stops: text('stops', { mode: 'json' }).$type<readonly WorkerStop[]>().notNull(),
  updates: text('updates', { mode: 'json' }).$type<readonly WorkerUpdate[]>().notNull(),
  artifacts: text('artifacts', { mode: 'json' }).$type<readonly AgentArtifact[]>().notNull().default([]),
  piSessionId: text('pi_session_id'),
  piSessionFile: text('pi_session_file'),
  summary: text('summary'),
  error: text('error'),
}, (table) => [
  primaryKey({ columns: [table.parentJobId, table.name] }),
  index('workers_job_idx').on(table.parentJobId),
]);

export const primaryAgents = sqliteTable('primary_agents', {
  sessionId: text('session_id').primaryKey().references(() => sessions.id, { onDelete: 'cascade' }),
  status: text('status').$type<PrimaryAgentStatus>().notNull(),
  currentJobId: text('current_job_id'),
  currentTask: text('current_task'),
  startedAt: text('started_at').notNull(),
  stops: text('stops', { mode: 'json' }).$type<readonly WorkerStop[]>().notNull(),
  updates: text('updates', { mode: 'json' }).$type<readonly WorkerUpdate[]>().notNull(),
  artifacts: text('artifacts', { mode: 'json' }).$type<readonly AgentArtifact[]>().notNull(),
  piSessionId: text('pi_session_id').notNull(),
  piSessionFile: text('pi_session_file'),
  error: text('error'),
});
