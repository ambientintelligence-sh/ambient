import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { and, eq, desc, count, inArray } from "drizzle-orm";
import { sessions, blocks, tasks, insights, agents, projects } from "./schema";
import { log } from "../logger";
import type {
  TaskItem,
  TaskSize,
  SuggestionKind,
  Insight,
  InsightKind,
  SessionMeta,
  ProjectMeta,
  TranscriptBlock,
  AudioSource,
  LanguageCode,
  Agent,
  AgentStep,
  FinalSummary,
  AgentsSummary,
  TodoItem,
} from "../types";

function normalizeTodoArray(raw: unknown): TodoItem[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item): TodoItem | null => {
      if (typeof item === "string") return { text: item, doer: "human" };
      if (item && typeof item === "object" && "text" in item && typeof item.text === "string") {
        const doer = (item as { doer?: unknown }).doer === "agent" ? "agent" as const : "human" as const;
        return { text: item.text, doer };
      }
      return null;
    })
    .filter((v): v is TodoItem => v !== null);
}

export type AppDatabase = ReturnType<typeof createDatabase>;

export function createDatabase(dbPath: string) {
  const sqlite = new Database(dbPath);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");

  runMigrations(sqlite);

  const orm: BetterSQLite3Database = drizzle({ client: sqlite });

  return {
    createSession(id: string, sourceLang?: LanguageCode, targetLang?: LanguageCode, title?: string, projectId?: string) {
      orm.insert(sessions).values({
        id,
        startedAt: Date.now(),
        title: title ?? null,
        sourceLang: sourceLang ?? null,
        targetLang: targetLang ?? null,
        projectId: projectId ?? null,
      }).run();
    },

    endSession(id: string) {
      const [blockRow] = orm
        .select({ n: count() })
        .from(blocks)
        .where(eq(blocks.sessionId, id))
        .all();
      const [agentRow] = orm
        .select({ n: count() })
        .from(agents)
        .where(eq(agents.sessionId, id))
        .all();
      const blockCount = blockRow?.n ?? 0;
      const agentCount = agentRow?.n ?? 0;
      const isEmpty = blockCount === 0 && agentCount === 0;

      orm.update(sessions)
        .set({
          endedAt: isEmpty ? null : Date.now(),
          blockCount,
        })
        .where(eq(sessions.id, id))
        .run();
    },

    deleteSession(id: string) {
      orm.transaction((tx) => {
        tx.delete(blocks).where(eq(blocks.sessionId, id)).run();
        tx.delete(agents).where(eq(agents.sessionId, id)).run();
        tx.delete(insights).where(eq(insights.sessionId, id)).run();
        tx.delete(tasks).where(eq(tasks.sessionId, id)).run();
        tx.delete(sessions).where(eq(sessions.id, id)).run();
      });
    },

    getSessions(limit = 20): SessionMeta[] {
      const rows = orm
        .select()
        .from(sessions)
        .orderBy(desc(sessions.startedAt))
        .limit(limit)
        .all();
      const countMap = batchAgentCounts(orm, rows.map((r) => r.id));
      return rows.map((r) => mapSessionRow(r, countMap.get(r.id) ?? 0));
    },

    getSessionsForProject(projectId: string, limit = 100): SessionMeta[] {
      const rows = orm
        .select()
        .from(sessions)
        .where(eq(sessions.projectId, projectId))
        .orderBy(desc(sessions.startedAt))
        .limit(limit)
        .all();
      const countMap = batchAgentCounts(orm, rows.map((r) => r.id));
      return rows.map((r) => mapSessionRow(r, countMap.get(r.id) ?? 0));
    },

    getMostRecentSession(): SessionMeta | null {
      const [row] = orm
        .select()
        .from(sessions)
        .orderBy(desc(sessions.startedAt))
        .limit(1)
        .all();
      if (!row) return null;
      const countMap = batchAgentCounts(orm, [row.id]);
      return mapSessionRow(row, countMap.get(row.id) ?? 0);
    },

    getSession(id: string): SessionMeta | null {
      const [row] = orm
        .select()
        .from(sessions)
        .where(eq(sessions.id, id))
        .limit(1)
        .all();
      if (!row) return null;
      const countMap = batchAgentCounts(orm, [id]);
      return mapSessionRow(row, countMap.get(id) ?? 0);
    },

    updateSessionTitle(sessionId: string, title: string) {
      orm.update(sessions).set({ title }).where(eq(sessions.id, sessionId)).run();
    },

    updateSessionProject(sessionId: string, projectId: string | null): SessionMeta | null {
      orm.update(sessions)
        .set({ projectId: projectId ?? null })
        .where(eq(sessions.id, sessionId))
        .run();
      return this.getSession(sessionId);
    },

    updateSessionLanguages(sessionId: string, sourceLang?: LanguageCode, targetLang?: LanguageCode): SessionMeta | null {
      orm.update(sessions)
        .set({
          sourceLang: sourceLang ?? null,
          targetLang: targetLang ?? null,
        })
        .where(eq(sessions.id, sessionId))
        .run();
      return this.getSession(sessionId);
    },

    isSessionEmpty(id: string): boolean {
      const [blockRow] = orm
        .select({ n: count() })
        .from(blocks)
        .where(eq(blocks.sessionId, id))
        .all();
      const [agentRow] = orm
        .select({ n: count() })
        .from(agents)
        .where(eq(agents.sessionId, id))
        .all();
      const [insightRow] = orm
        .select({ n: count() })
        .from(insights)
        .where(eq(insights.sessionId, id))
        .all();
      const [taskRow] = orm
        .select({ n: count() })
        .from(tasks)
        .where(eq(tasks.sessionId, id))
        .all();

      return (blockRow?.n ?? 0) === 0
        && (agentRow?.n ?? 0) === 0
        && (insightRow?.n ?? 0) === 0
        && (taskRow?.n ?? 0) === 0;
    },

    reuseSession(id: string, sourceLang?: LanguageCode, targetLang?: LanguageCode) {
      orm.update(sessions)
        .set({
          startedAt: Date.now(),
          endedAt: null,
          sourceLang: sourceLang ?? null,
          targetLang: targetLang ?? null,
        })
        .where(eq(sessions.id, id))
        .run();
    },

    insertBlock(sessionId: string, block: TranscriptBlock) {
      orm.insert(blocks).values({
        sessionId,
        sourceLabel: block.sourceLabel,
        sourceText: block.sourceText,
        targetLabel: block.targetLabel,
        translation: block.translation ?? null,
        audioSource: block.audioSource,
        partial: block.partial ? 1 : 0,
        newTopic: block.newTopic ? 1 : 0,
        createdAt: block.createdAt,
      }).run();
    },

    getBlocksForSession(sessionId: string): TranscriptBlock[] {
      const rows = orm
        .select()
        .from(blocks)
        .where(eq(blocks.sessionId, sessionId))
        .orderBy(blocks.createdAt)
        .all();
      return rows.map((r) => ({
        id: r.id,
        sourceLabel: r.sourceLabel,
        sourceText: r.sourceText,
        targetLabel: r.targetLabel,
        translation: r.translation ?? undefined,
        audioSource: r.audioSource as AudioSource,
        partial: r.partial === 1,
        newTopic: r.newTopic === 1,
        createdAt: r.createdAt,
        sessionId: r.sessionId,
      }));
    },

    insertTask(task: TaskItem) {
      orm.insert(tasks).values({
        id: task.id,
        text: task.text,
        details: task.details ?? null,
        size: task.size,
        completed: task.completed ? 1 : 0,
        archived: task.archived ? 1 : 0,
        suggestionKind: task.suggestionKind ?? null,
        source: task.source,
        createdAt: task.createdAt,
        sessionId: task.sessionId ?? null,
      }).run();
    },

    updateTask(id: string, completed: boolean) {
      orm.update(tasks)
        .set({ completed: completed ? 1 : 0, completedAt: completed ? Date.now() : null })
        .where(eq(tasks.id, id))
        .run();
    },

    deleteTask(id: string) {
      orm.transaction((tx) => {
        tx.delete(agents).where(eq(agents.taskId, id)).run();
        tx.delete(tasks).where(eq(tasks.id, id)).run();
      });
    },

    updateTaskText(id: string, text: string, size: TaskSize) {
      orm.update(tasks)
        .set({ text, size })
        .where(eq(tasks.id, id))
        .run();
    },

    getTask(id: string): TaskItem | null {
      const [row] = orm
        .select()
        .from(tasks)
        .where(eq(tasks.id, id))
        .limit(1)
        .all();
      return row ? mapTaskRow(row) : null;
    },

    getTasks(): TaskItem[] {
      const rows = orm
        .select()
        .from(tasks)
        .where(eq(tasks.archived, 0))
        .orderBy(desc(tasks.createdAt))
        .all();
      return rows.map(mapTaskRow);
    },

    getTasksForSession(sessionId: string): TaskItem[] {
      const rows = orm
        .select()
        .from(tasks)
        .where(and(eq(tasks.sessionId, sessionId), eq(tasks.archived, 0)))
        .orderBy(desc(tasks.createdAt))
        .all();
      return rows.map(mapTaskRow);
    },

    archiveTask(id: string) {
      orm.update(tasks).set({ archived: 1 }).where(eq(tasks.id, id)).run();
    },

    unarchiveTask(id: string) {
      orm.update(tasks).set({ archived: 0 }).where(eq(tasks.id, id)).run();
    },

    getArchivedTasksForSession(sessionId: string): TaskItem[] {
      const rows = orm
        .select()
        .from(tasks)
        .where(and(eq(tasks.sessionId, sessionId), eq(tasks.archived, 1)))
        .orderBy(desc(tasks.createdAt))
        .all();
      return rows.map(mapTaskRow);
    },

    insertInsight(insight: Insight) {
      orm.insert(insights).values({
        id: insight.id,
        kind: insight.kind,
        text: insight.text,
        sessionId: insight.sessionId ?? null,
        createdAt: insight.createdAt,
      }).run();
    },

    getRecentInsights(limit = 50): Insight[] {
      const rows = orm
        .select()
        .from(insights)
        .orderBy(desc(insights.createdAt))
        .limit(limit)
        .all();
      return rows.map(mapInsightRow);
    },

    getInsightsForSession(sessionId: string): Insight[] {
      const rows = orm
        .select()
        .from(insights)
        .where(eq(insights.sessionId, sessionId))
        .orderBy(desc(insights.createdAt))
        .all();
      return rows.map(mapInsightRow);
    },

    getRecentKeyPoints(limit = 20): string[] {
      const rows = orm
        .select({ text: insights.text })
        .from(insights)
        .where(eq(insights.kind, "key-point"))
        .orderBy(desc(insights.createdAt))
        .limit(limit)
        .all();
      return rows.map((r) => r.text);
    },

    searchBlocks(query: string, limit = 50): TranscriptBlock[] {
      // FTS5 requires raw SQL — Drizzle doesn't support virtual tables
      const rows = sqlite
        .prepare(
          `SELECT b.id, b.session_id, b.source_label, b.source_text, b.target_label, b.translation,
                  b.audio_source, b.partial, b.new_topic, b.created_at
           FROM blocks_fts f
           JOIN blocks b ON b.id = f.rowid
           WHERE blocks_fts MATCH ?
           ORDER BY b.created_at DESC
           LIMIT ?`
        )
        .all(query, limit) as Array<{
        id: number; session_id: string; source_label: string; source_text: string;
        target_label: string; translation: string | null; audio_source: string;
        partial: number; new_topic: number; created_at: number;
      }>;
      return rows.map((r) => ({
        id: r.id,
        sourceLabel: r.source_label,
        sourceText: r.source_text,
        targetLabel: r.target_label,
        translation: r.translation ?? undefined,
        audioSource: r.audio_source as AudioSource,
        partial: r.partial === 1,
        newTopic: r.new_topic === 1,
        createdAt: r.created_at,
        sessionId: r.session_id,
      }));
    },

    // Agent persistence
    insertAgent(agent: Agent) {
      orm.insert(agents).values({
        id: agent.id,
        kind: agent.kind,
        taskId: agent.taskId ?? "",
        sessionId: agent.sessionId ?? null,
        task: agent.task,
        taskContext: agent.taskContext ?? null,
        status: agent.status,
        result: agent.result ?? null,
        steps: agent.steps,
        createdAt: agent.createdAt,
        completedAt: agent.completedAt ?? null,
      }).run();
    },

    updateAgent(id: string, fields: { status?: string; result?: string; steps?: AgentStep[]; completedAt?: number }) {
      const set: Record<string, unknown> = {};
      if (fields.status !== undefined) set.status = fields.status;
      if (fields.result !== undefined) set.result = fields.result;
      if (fields.steps !== undefined) set.steps = fields.steps;
      if (fields.completedAt !== undefined) set.completedAt = fields.completedAt;
      orm.update(agents).set(set).where(eq(agents.id, id)).run();
    },

    updateAgentTask(id: string, task: string) {
      orm.update(agents).set({ task }).where(eq(agents.id, id)).run();
    },

    archiveAgent(id: string) {
      orm.update(agents).set({ archived: 1 }).where(eq(agents.id, id)).run();
    },

    getAgentsForSession(sessionId: string): Agent[] {
      const rows = orm
        .select()
        .from(agents)
        .where(and(eq(agents.sessionId, sessionId), eq(agents.archived, 0)))
        .orderBy(desc(agents.createdAt))
        .all();
      return rows.map((r) => ({
        id: r.id,
        kind: coerceAgentKind(r.kind, r.taskId),
        taskId: r.taskId || undefined,
        task: r.task,
        taskContext: r.taskContext ?? undefined,
        status: r.status as Agent["status"],
        result: r.result ?? undefined,
        steps: (r.steps ?? []) as AgentStep[],
        createdAt: r.createdAt,
        completedAt: r.completedAt ?? undefined,
        sessionId: r.sessionId ?? undefined,
      }));
    },

    // Project CRUD
    createProject(id: string, name: string, instructions?: string, context?: string): ProjectMeta {
      const createdAt = Date.now();
      orm.insert(projects).values({ id, name, instructions: instructions ?? null, context: context ?? null, createdAt }).run();
      return { id, name, instructions: instructions ?? undefined, context: context ?? undefined, createdAt };
    },

    getProjects(): ProjectMeta[] {
      const rows = orm.select().from(projects).orderBy(desc(projects.createdAt)).all();
      return rows.map((r) => ({
        id: r.id,
        name: r.name,
        instructions: r.instructions ?? undefined,
        context: r.context ?? undefined,
        createdAt: r.createdAt,
      }));
    },

    getProject(id: string): ProjectMeta | null {
      const [row] = orm.select().from(projects).where(eq(projects.id, id)).limit(1).all();
      if (!row) return null;
      return { id: row.id, name: row.name, instructions: row.instructions ?? undefined, context: row.context ?? undefined, createdAt: row.createdAt };
    },

    updateProject(id: string, patch: { name?: string; instructions?: string; context?: string }): ProjectMeta | null {
      const set: Record<string, unknown> = {};
      if (patch.name !== undefined) set.name = patch.name;
      if (patch.instructions !== undefined) set.instructions = patch.instructions || null;
      if (patch.context !== undefined) set.context = patch.context || null;
      if (Object.keys(set).length > 0) {
        orm.update(projects).set(set).where(eq(projects.id, id)).run();
      }
      return this.getProject(id);
    },

    deleteProject(id: string) {
      orm.transaction((tx) => {
        tx.update(sessions).set({ projectId: null }).where(eq(sessions.projectId, id)).run();
        tx.delete(projects).where(eq(projects.id, id)).run();
      });
    },


    saveFinalSummary(sessionId: string, summary: FinalSummary) {
      orm.update(sessions)
        .set({
          summaryNarrative: summary.narrative,
          summaryActionItems: JSON.stringify(summary.actionItems),
          summaryData: JSON.stringify(summary),
          summaryGeneratedAt: summary.generatedAt,
        })
        .where(eq(sessions.id, sessionId))
        .run();
    },

    saveAgentsSummary(sessionId: string, summary: AgentsSummary) {
      orm.update(sessions)
        .set({
          agentsSummaryData: JSON.stringify(summary),
          agentsSummaryGeneratedAt: summary.generatedAt,
        })
        .where(eq(sessions.id, sessionId))
        .run();
    },

    getAgentsSummary(sessionId: string): AgentsSummary | null {
      const [row] = orm
        .select({ agentsSummaryData: sessions.agentsSummaryData })
        .from(sessions)
        .where(eq(sessions.id, sessionId))
        .limit(1)
        .all();
      if (!row?.agentsSummaryData) return null;
      return JSON.parse(row.agentsSummaryData) as AgentsSummary;
    },

    getFinalSummary(sessionId: string): FinalSummary | null {
      const [row] = orm
        .select({
          summaryNarrative: sessions.summaryNarrative,
          summaryActionItems: sessions.summaryActionItems,
          summaryData: sessions.summaryData,
          summaryGeneratedAt: sessions.summaryGeneratedAt,
        })
        .from(sessions)
        .where(eq(sessions.id, sessionId))
        .limit(1)
        .all();
      if (!row?.summaryNarrative && !row?.summaryData) return null;

      if (row?.summaryData) {
        try {
          const parsed = JSON.parse(row.summaryData) as Record<string, unknown>;
          if (typeof parsed.narrative === "string") {
            return {
              narrative: parsed.narrative,
              agreements: Array.isArray(parsed.agreements) ? parsed.agreements.filter((v): v is string => typeof v === "string") : [],
              missedItems: Array.isArray(parsed.missedItems) ? parsed.missedItems.filter((v): v is string => typeof v === "string") : [],
              unansweredQuestions: Array.isArray(parsed.unansweredQuestions) ? parsed.unansweredQuestions.filter((v): v is string => typeof v === "string") : [],
              agreementTodos: normalizeTodoArray(parsed.agreementTodos),
              missedItemTodos: normalizeTodoArray(parsed.missedItemTodos),
              unansweredQuestionTodos: normalizeTodoArray(parsed.unansweredQuestionTodos),
              actionItems: normalizeTodoArray(parsed.actionItems),
              acceptedTodoIds: Array.isArray(parsed.acceptedTodoIds)
                ? parsed.acceptedTodoIds.filter((v): v is string => typeof v === "string")
                : undefined,
              modelId: typeof parsed.modelId === "string" ? parsed.modelId : undefined,
              generatedAt: typeof parsed.generatedAt === "number" ? parsed.generatedAt : (row.summaryGeneratedAt ?? 0),
            };
          }
        } catch {
          // Fall through to legacy fields below.
        }
      }

      if (!row.summaryNarrative) return null;
      return {
        narrative: row.summaryNarrative,
        agreements: [],
        missedItems: [],
        unansweredQuestions: [],
        agreementTodos: [],
        missedItemTodos: [],
        unansweredQuestionTodos: [],
        actionItems: normalizeTodoArray(JSON.parse(row.summaryActionItems ?? "[]")),
        generatedAt: row.summaryGeneratedAt ?? 0,
      };
    },

    failStaleRunningAgents(reason: string): number {
      const completedAt = Date.now();
      const result = sqlite
        .prepare(`
          UPDATE agents
          SET status = 'failed',
              result = COALESCE(result, @reason),
              completed_at = COALESCE(completed_at, @completedAt)
          WHERE status = 'running'
        `)
        .run({ reason, completedAt });
      return result.changes;
    },

    // --- Agent FTS5 ---

    indexAgentFts(agentId: string, task: string, result: string, taskContext: string | null) {
      const existing = sqlite
        .prepare("SELECT fts_rowid FROM agents_fts_map WHERE agent_id = ?")
        .get(agentId) as { fts_rowid: number } | undefined;

      if (existing) {
        sqlite.prepare(
          "UPDATE agents_fts SET task = ?, result = ?, task_context = ? WHERE rowid = ?",
        ).run(task, result, taskContext ?? "", existing.fts_rowid);
      } else {
        sqlite.prepare(
          "INSERT INTO agents_fts(task, result, task_context) VALUES (?, ?, ?)",
        ).run(task, result, taskContext ?? "");
        const rowid = (sqlite.prepare("SELECT last_insert_rowid() as r").get() as { r: number }).r;
        sqlite.prepare(
          "INSERT INTO agents_fts_map(agent_id, fts_rowid) VALUES (?, ?)",
        ).run(agentId, rowid);
      }
    },

    searchAgents(query: string, limit = 20): Agent[] {
      const rows = sqlite
        .prepare(
          `SELECT m.agent_id
           FROM agents_fts f
           JOIN agents_fts_map m ON m.fts_rowid = f.rowid
           WHERE agents_fts MATCH ?
           LIMIT ?`,
        )
        .all(query, limit) as Array<{ agent_id: string }>;

      if (rows.length === 0) return [];

      const ids = rows.map((r) => r.agent_id);
      const placeholders = ids.map(() => "?").join(",");
      const agentRows = sqlite
        .prepare(
          `SELECT * FROM agents WHERE id IN (${placeholders})`,
        )
        .all(...ids) as Array<Record<string, unknown>>;

      return agentRows.map(mapRawAgentRow);
    },

    close() {
      sqlite.close();
    },

    raw: sqlite,
  };
}

function mapSessionRow(r: typeof sessions.$inferSelect, agentCount = 0): SessionMeta {
  return {
    id: r.id,
    startedAt: r.startedAt,
    endedAt: r.endedAt ?? undefined,
    title: r.title ?? undefined,
    blockCount: r.blockCount ?? 0,
    agentCount,
    sourceLang: (r.sourceLang as LanguageCode) ?? undefined,
    targetLang: (r.targetLang as LanguageCode) ?? undefined,
    projectId: r.projectId ?? undefined,
  };
}

function batchAgentCounts(orm: BetterSQLite3Database, sessionIds: string[]): Map<string, number> {
  if (sessionIds.length === 0) return new Map();
  const rows = orm
    .select({ sessionId: agents.sessionId, n: count() })
    .from(agents)
    .where(and(inArray(agents.sessionId, sessionIds), eq(agents.archived, 0)))
    .groupBy(agents.sessionId)
    .all();
  return new Map(rows.map((r) => [r.sessionId!, r.n]));
}

function coerceAgentKind(kind: string | null | undefined, taskId: string | null | undefined): Agent["kind"] {
  if (kind === "analysis" || kind === "custom") return kind;
  return taskId && taskId.trim() ? "analysis" : "custom";
}

function mapTaskRow(r: typeof tasks.$inferSelect): TaskItem {
  return {
    id: r.id,
    text: r.text,
    details: r.details ?? undefined,
    size: (r.size as TaskSize) ?? "large",
    completed: r.completed === 1,
    archived: r.archived === 1 || undefined,
    suggestionKind: (r.suggestionKind as SuggestionKind) ?? undefined,
    source: r.source as "ai" | "manual",
    createdAt: r.createdAt,
    completedAt: r.completedAt ?? undefined,
    sessionId: r.sessionId ?? undefined,
  };
}

function mapRawAgentRow(r: Record<string, unknown>): Agent {
  const kind = r.kind as string | null;
  const taskId = r.task_id as string | null;
  return {
    id: r.id as string,
    kind: coerceAgentKind(kind, taskId),
    taskId: (taskId || undefined),
    task: r.task as string,
    taskContext: (r.task_context as string | null) ?? undefined,
    status: r.status as Agent["status"],
    result: (r.result as string | null) ?? undefined,
    steps: ((r.steps ?? []) as AgentStep[]),
    createdAt: r.created_at as number,
    completedAt: (r.completed_at as number | null) ?? undefined,
    sessionId: (r.session_id as string | null) ?? undefined,
  };
}

function mapInsightRow(r: typeof insights.$inferSelect): Insight {
  return {
    id: r.id,
    kind: r.kind as InsightKind,
    text: r.text,
    sessionId: r.sessionId ?? undefined,
    createdAt: r.createdAt,
  };
}

function runMigrations(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      started_at INTEGER NOT NULL,
      ended_at INTEGER,
      title TEXT,
      block_count INTEGER DEFAULT 0,
      source_lang TEXT,
      target_lang TEXT
    );

    CREATE TABLE IF NOT EXISTS blocks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL REFERENCES sessions(id),
      source_label TEXT NOT NULL,
      source_text TEXT NOT NULL,
      target_label TEXT NOT NULL,
      translation TEXT,
      audio_source TEXT NOT NULL DEFAULT 'system',
      partial INTEGER DEFAULT 0,
      new_topic INTEGER DEFAULT 0,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      text TEXT NOT NULL,
      details TEXT,
      size TEXT NOT NULL DEFAULT 'large',
      completed INTEGER DEFAULT 0,
      source TEXT NOT NULL DEFAULT 'manual',
      created_at INTEGER NOT NULL,
      completed_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS insights (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      text TEXT NOT NULL,
      session_id TEXT,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS agents (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL DEFAULT 'analysis',
      task_id TEXT NOT NULL,
      session_id TEXT REFERENCES sessions(id),
      task TEXT NOT NULL,
      task_context TEXT,
      status TEXT NOT NULL DEFAULT 'running',
      result TEXT,
      steps TEXT DEFAULT '[]',
      created_at INTEGER NOT NULL,
      completed_at INTEGER
    );

    CREATE INDEX IF NOT EXISTS idx_blocks_session ON blocks(session_id);
    CREATE INDEX IF NOT EXISTS idx_blocks_created ON blocks(created_at);
    CREATE INDEX IF NOT EXISTS idx_tasks_completed ON tasks(completed);
    CREATE INDEX IF NOT EXISTS idx_insights_created ON insights(created_at);
    CREATE INDEX IF NOT EXISTS idx_agents_session ON agents(session_id);

    CREATE VIRTUAL TABLE IF NOT EXISTS blocks_fts USING fts5(
      source_text,
      translation,
      content='blocks',
      content_rowid='id'
    );

    CREATE TRIGGER IF NOT EXISTS blocks_ai AFTER INSERT ON blocks BEGIN
      INSERT INTO blocks_fts(rowid, source_text, translation)
      VALUES (new.id, new.source_text, COALESCE(new.translation, ''));
    END;

    CREATE TRIGGER IF NOT EXISTS blocks_ad AFTER DELETE ON blocks BEGIN
      INSERT INTO blocks_fts(blocks_fts, rowid, source_text, translation)
      VALUES ('delete', old.id, old.source_text, COALESCE(old.translation, ''));
    END;
  `);

  // Backward-compat migrations for existing DBs
  const cols = db.prepare("PRAGMA table_info(sessions)").all() as Array<{ name: string }>;
  const colNames = new Set(cols.map((c) => c.name));
  if (!colNames.has("source_lang")) {
    db.exec("ALTER TABLE sessions ADD COLUMN source_lang TEXT");
  }
  if (!colNames.has("target_lang")) {
    db.exec("ALTER TABLE sessions ADD COLUMN target_lang TEXT");
  }

  const taskCols = db.prepare("PRAGMA table_info(tasks)").all() as Array<{ name: string }>;
  const taskColNames = new Set(taskCols.map((c) => c.name));
  if (!taskColNames.has("session_id")) {
    db.exec("ALTER TABLE tasks ADD COLUMN session_id TEXT");
  }
  if (!taskColNames.has("size")) {
    db.exec("ALTER TABLE tasks ADD COLUMN size TEXT NOT NULL DEFAULT 'large'");
  }
  if (!taskColNames.has("details")) {
    db.exec("ALTER TABLE tasks ADD COLUMN details TEXT");
  }
  if (!taskColNames.has("archived")) {
    db.exec("ALTER TABLE tasks ADD COLUMN archived INTEGER NOT NULL DEFAULT 0");
  }
  if (!taskColNames.has("suggestion_kind")) {
    db.exec("ALTER TABLE tasks ADD COLUMN suggestion_kind TEXT");
  }

  const agentCols = db.prepare("PRAGMA table_info(agents)").all() as Array<{ name: string }>;
  const agentColNames = new Set(agentCols.map((c) => c.name));
  if (!agentColNames.has("kind")) {
    db.exec("ALTER TABLE agents ADD COLUMN kind TEXT NOT NULL DEFAULT 'analysis'");
    // Backfill pre-kind rows: empty task_id rows are custom agents.
    db.exec("UPDATE agents SET kind = 'custom' WHERE COALESCE(task_id, '') = ''");
  }
  if (!agentColNames.has("task_context")) {
    db.exec("ALTER TABLE agents ADD COLUMN task_context TEXT");
  }
  if (!agentColNames.has("archived")) {
    db.exec("ALTER TABLE agents ADD COLUMN archived INTEGER NOT NULL DEFAULT 0");
  }

  // Projects feature migrations
  db.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      instructions TEXT,
      created_at INTEGER NOT NULL
    );
  `);

  const projectCols = db.prepare("PRAGMA table_info(projects)").all() as Array<{ name: string }>;
  const projectColNames = new Set(projectCols.map((c) => c.name));
  if (!projectColNames.has("context")) {
    db.exec("ALTER TABLE projects ADD COLUMN context TEXT");
  }

  const sessionCols2 = db.prepare("PRAGMA table_info(sessions)").all() as Array<{ name: string }>;
  const sessionColNames2 = new Set(sessionCols2.map((c) => c.name));
  if (!sessionColNames2.has("project_id")) {
    db.exec("ALTER TABLE sessions ADD COLUMN project_id TEXT REFERENCES projects(id)");
  }
  if (!sessionColNames2.has("summary_narrative")) {
    db.exec("ALTER TABLE sessions ADD COLUMN summary_narrative TEXT");
  }
  if (!sessionColNames2.has("summary_action_items")) {
    db.exec("ALTER TABLE sessions ADD COLUMN summary_action_items TEXT");
  }
  if (!sessionColNames2.has("summary_data")) {
    db.exec("ALTER TABLE sessions ADD COLUMN summary_data TEXT");
  }
  if (!sessionColNames2.has("summary_generated_at")) {
    db.exec("ALTER TABLE sessions ADD COLUMN summary_generated_at INTEGER");
  }
  if (!sessionColNames2.has("agents_summary_data")) {
    db.exec("ALTER TABLE sessions ADD COLUMN agents_summary_data TEXT");
  }
  if (!sessionColNames2.has("agents_summary_generated_at")) {
    db.exec("ALTER TABLE sessions ADD COLUMN agents_summary_generated_at INTEGER");
  }

  // Agent FTS5 for local memory system
  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS agents_fts USING fts5(task, result, task_context);

    CREATE TABLE IF NOT EXISTS agents_fts_map (
      agent_id TEXT PRIMARY KEY,
      fts_rowid INTEGER NOT NULL
    );
  `);

}
