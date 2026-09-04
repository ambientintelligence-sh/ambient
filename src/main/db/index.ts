import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { drizzle } from 'drizzle-orm/node-sqlite';
import { migrate } from 'drizzle-orm/node-sqlite/migrator';

export function openDatabase(databasePath: string, migrationsFolder: string) {
  mkdirSync(path.dirname(databasePath), { recursive: true, mode: 0o700 });
  const sqlite = new DatabaseSync(databasePath);
  sqlite.exec('PRAGMA foreign_keys = ON');
  sqlite.exec('PRAGMA journal_mode = WAL');
  sqlite.exec('PRAGMA busy_timeout = 5000');
  const db = drizzle({ client: sqlite });
  const result = migrate(db, { migrationsFolder });
  if (result) {
    sqlite.close();
    throw new Error(`Database migration initialization failed: ${result.exitCode}`);
  }
  return { db, close: () => sqlite.close() };
}

export type AmbientDatabase = ReturnType<typeof openDatabase>['db'];
