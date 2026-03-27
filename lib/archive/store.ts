import { db } from "@/lib/db/client";
import { ensureUser } from "@/lib/db/schema";
import { Intervention, TopicType } from "@/lib/types";
import { makeId } from "@/lib/utils";

const ALLOWED_TOPICS = new Set<TopicType>([
  "关系冲突",
  "重要决策",
  "反复困扰",
  "失落打击",
  "自我认同波动"
]);

function ensureArchive(userId: string) {
  const existing = db
    .prepare("SELECT id FROM event_archives WHERE user_id = ? ORDER BY updated_at DESC LIMIT 1")
    .get(userId) as { id: string } | undefined;

  if (existing) return existing.id;

  const now = new Date().toISOString();
  const id = makeId("archive");
  db.prepare(
    "INSERT INTO event_archives (id, user_id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?)"
  ).run(id, userId, "默认档案", now, now);
  return id;
}

function findRecentEventByTopic(archiveId: string, topic: string) {
  const row = db
    .prepare("SELECT id, occurred_at FROM events WHERE archive_id = ? AND topic = ? ORDER BY occurred_at DESC LIMIT 1")
    .get(archiveId, topic) as { id: string; occurred_at: string } | undefined;
  if (!row) return undefined;

  const occurredAt = new Date(row.occurred_at).getTime();
  const now = Date.now();
  const within72h = now - occurredAt <= 72 * 60 * 60 * 1000;
  return within72h ? row.id : undefined;
}

export function writeEventRecord(params: {
  userId: string;
  topic: TopicType;
  eventOverview: string;
  intervention: Intervention;
  shouldRecord: boolean;
}) {
  if (!params.shouldRecord || !ALLOWED_TOPICS.has(params.topic)) return { recorded: false };

  const now = new Date().toISOString();
  // event_archives.user_id 外键依赖 users，必须先插入 users
  ensureUser(params.userId);
  const archiveId = ensureArchive(params.userId);
  const eventId = findRecentEventByTopic(archiveId, params.topic) ?? makeId("event");

  const tx = db.transaction(() => {
    if (!findRecentEventByTopic(archiveId, params.topic)) {
      db.prepare(
        "INSERT INTO events (id, archive_id, topic, overview, occurred_at, created_at) VALUES (?, ?, ?, ?, ?, ?)"
      ).run(eventId, archiveId, params.topic, params.eventOverview, now, now);
    }

    db.prepare("UPDATE event_archives SET updated_at = ? WHERE id = ?").run(now, archiveId);

    db.prepare(
      "INSERT INTO intervention_history (id, event_id, ts, user_emotion, five_state, stage, technique, meta_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
    ).run(
      makeId("hist"),
      eventId,
      params.intervention.ts,
      params.intervention.userEmotion,
      params.intervention.fiveState,
      params.intervention.stage,
      params.intervention.technique,
      JSON.stringify(params.intervention.meta ?? {})
    );
  });
  tx();

  return { recorded: true, eventId };
}

/** 读取当前用户档案下的事件及每条事件的干预历史（可选按 topic 过滤） */
export function readEventRecords(userId: string, filters?: { topic?: string }) {
  ensureUser(userId);
  const archive = db
    .prepare("SELECT id FROM event_archives WHERE user_id = ? ORDER BY updated_at DESC LIMIT 1")
    .get(userId) as { id: string } | undefined;
  if (!archive) return { archiveId: null as string | null, events: [] as Array<EventRecordRow & { interventions: InterventionRow[] }> };

  let sql =
    "SELECT id, topic, overview, occurred_at FROM events WHERE archive_id = ?";
  const params: string[] = [archive.id];
  if (filters?.topic) {
    sql += " AND topic = ?";
    params.push(filters.topic);
  }
  sql += " ORDER BY occurred_at DESC";

  const events = db.prepare(sql).all(...params) as Array<{
    id: string;
    topic: string;
    overview: string;
    occurred_at: string;
  }>;

  const histStmt = db.prepare(
    "SELECT id, ts, user_emotion, five_state, stage, technique, meta_json FROM intervention_history WHERE event_id = ? ORDER BY ts DESC"
  );

  return {
    archiveId: archive.id,
    events: events.map((e) => {
      const rows = histStmt.all(e.id) as Array<{
        id: string;
        ts: string;
        user_emotion: string;
        five_state: string;
        stage: string;
        technique: string;
        meta_json: string | null;
      }>;
      return {
        eventId: e.id,
        topic: e.topic,
        overview: e.overview,
        occurredAt: e.occurred_at,
        interventions: rows.map((r) => ({
          id: r.id,
          ts: r.ts,
          userEmotion: r.user_emotion,
          fiveState: r.five_state,
          stage: r.stage,
          technique: r.technique,
          metaJson: r.meta_json
        }))
      };
    })
  };
}
