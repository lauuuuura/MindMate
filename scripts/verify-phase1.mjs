#!/usr/bin/env node
/**
 * 第一阶段自检：SQLite 文件存在、核心表可查询。
 * 用法：node scripts/verify-phase1.mjs
 */
import Database from "better-sqlite3";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const dbPath = path.join(root, "data.sqlite");

const requiredTables = [
  "users",
  "event_archives",
  "events",
  "intervention_history",
  "user_memory"
];

function main() {
  const db = new Database(dbPath);
  const rows = db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
    )
    .all();
  const names = new Set(rows.map((r) => r.name));
  const missing = requiredTables.filter((t) => !names.has(t));
  if (missing.length) {
    console.error("FAIL: missing tables:", missing.join(", "));
    process.exit(1);
  }
  for (const t of requiredTables) {
    const c = db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get();
    console.log(`OK table ${t}: ${c.n} rows`);
  }
  db.close();
  console.log("PASS: phase1 sqlite schema OK");
}

try {
  main();
} catch (e) {
  console.error("FAIL:", e.message || e);
  process.exit(1);
}
