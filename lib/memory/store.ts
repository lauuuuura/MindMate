import { db } from "@/lib/db/client";
import { ensureUser } from "@/lib/db/schema";
import { makeId } from "@/lib/utils";

export type MemoryItem = { category: string; content: string };

export function readUserMemory(userId: string) {
  return db
    .prepare("SELECT category, content, updated_at FROM user_memory WHERE user_id = ?")
    .all(userId) as Array<{ category: string; content: string; updated_at: string }>;
}

export function upsertUserMemory(userId: string, items: MemoryItem[]) {
  ensureUser(userId);
  const now = new Date().toISOString();
  const selectStmt = db.prepare(
    "SELECT id FROM user_memory WHERE user_id = ? AND category = ? AND content = ?"
  );
  const insertStmt = db.prepare(
    "INSERT INTO user_memory (id, user_id, category, content, updated_at) VALUES (?, ?, ?, ?, ?)"
  );
  const updateStmt = db.prepare("UPDATE user_memory SET updated_at = ? WHERE id = ?");

  const tx = db.transaction(() => {
    for (const item of items) {
      const row = selectStmt.get(userId, item.category, item.content) as { id: string } | undefined;
      if (row) {
        updateStmt.run(now, row.id);
      } else {
        insertStmt.run(makeId("mem"), userId, item.category, item.content, now);
      }
    }
  });
  tx();
}
