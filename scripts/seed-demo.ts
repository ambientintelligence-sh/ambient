/**
 * Dev convenience script: resets the DB and seeds demo data.
 * Run: npx tsx scripts/seed-demo.ts
 */
import path from "node:path";
import os from "node:os";
import { createDatabase } from "../src/core/db/db";
import { seedDemoData } from "../src/core/db/seed-demo";

const DB_PATH = path.join(
  os.homedir(),
  "Library/Application Support/ambient/ambient.db",
);

const appDb = createDatabase(DB_PATH);
seedDemoData(appDb.raw);
appDb.close();

console.log("Seeded 4 demo sessions with agents, summaries, and fleet debrief.");
