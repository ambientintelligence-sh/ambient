#!/bin/bash
# One-time backfill: index existing completed agents into agents_fts.
# Only needed for dev DBs that had agents before the FTS tables were added.
#
# Usage: ./scripts/backfill-agent-fts.sh [path-to-db]

DB="${1:-$HOME/Library/Application Support/ambient/ambient.db}"

if [ ! -f "$DB" ]; then
  echo "Database not found: $DB"
  exit 1
fi

sqlite3 "$DB" <<'SQL'
CREATE VIRTUAL TABLE IF NOT EXISTS agents_fts USING fts5(task, result, task_context);
CREATE TABLE IF NOT EXISTS agents_fts_map (
  agent_id TEXT PRIMARY KEY,
  fts_rowid INTEGER NOT NULL
);

INSERT INTO agents_fts(task, result, task_context)
  SELECT task, result, COALESCE(task_context, '')
  FROM agents
  WHERE status = 'completed' AND result IS NOT NULL
    AND id NOT IN (SELECT agent_id FROM agents_fts_map);

INSERT INTO agents_fts_map(agent_id, fts_rowid)
  SELECT a.id, f.rowid
  FROM agents a
  JOIN agents_fts f ON f.task = a.task AND f.result = a.result
  WHERE a.status = 'completed' AND a.result IS NOT NULL
    AND a.id NOT IN (SELECT agent_id FROM agents_fts_map);

SELECT 'Backfilled. Total FTS entries: ' || count(*) FROM agents_fts_map;
SQL
