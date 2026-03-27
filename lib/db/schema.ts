import { db } from "@/lib/db/client";

let initialized = false;

export function initSchema() {
  if (initialized) return;

  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS event_archives (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      title TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS events (
      id TEXT PRIMARY KEY,
      archive_id TEXT NOT NULL,
      topic TEXT NOT NULL,
      overview TEXT NOT NULL,
      occurred_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY(archive_id) REFERENCES event_archives(id)
    );

    CREATE TABLE IF NOT EXISTS intervention_history (
      id TEXT PRIMARY KEY,
      event_id TEXT NOT NULL,
      ts TEXT NOT NULL,
      user_emotion TEXT NOT NULL,
      five_state TEXT NOT NULL,
      stage TEXT NOT NULL,
      technique TEXT NOT NULL,
      meta_json TEXT,
      FOREIGN KEY(event_id) REFERENCES events(id)
    );

    CREATE TABLE IF NOT EXISTS user_memory (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      category TEXT NOT NULL,
      content TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(user_id) REFERENCES users(id)
    );
  `);

  initialized = true;
}

/** 必须先存在 users 行，event_archives / user_memory 等外键才能插入 */
export function ensureUser(userId: string) {
  const now = new Date().toISOString();
  db.prepare("INSERT OR IGNORE INTO users (id, created_at) VALUES (?, ?)").run(userId, now);
}
