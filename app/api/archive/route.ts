import { readEventRecords } from "@/lib/archive/store";
import { initSchema } from "@/lib/db/schema";
import { jsonUtf8 } from "@/lib/server/json-response";
import { resolveArchiveUserId } from "@/lib/server/resolve-archive-user";

/**
 * GET /api/archive?topic=关系冲突
 * 用户身份：仅 Cookie `mindmate_user_id`（默认）。本地调试查看他人数据需 ALLOW_DEBUG_USER_ID=1 且带 ?userId=。
 */
export async function GET(req: Request) {
  initSchema();
  const url = new URL(req.url);
  const topic = url.searchParams.get("topic") ?? undefined;

  const { userId, error } = resolveArchiveUserId(req);
  if (!userId) {
    const status = error?.includes("已忽略") ? 403 : 400;
    return jsonUtf8({ error: error ?? "缺少用户身份（请先在本站聊天以写入 Cookie）" }, { status });
  }

  const data = readEventRecords(userId, topic ? { topic } : undefined);
  return jsonUtf8(data);
}
