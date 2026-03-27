import { initSchema } from "@/lib/db/schema";
import { readUserMemory } from "@/lib/memory/store";
import { jsonUtf8 } from "@/lib/server/json-response";
import { resolveArchiveUserId } from "@/lib/server/resolve-archive-user";

/** GET /api/memory — 读取长期记忆（身份规则同 /api/archive） */
export async function GET(req: Request) {
  initSchema();

  const { userId, error } = resolveArchiveUserId(req);
  if (!userId) {
    const status = error?.includes("已忽略") ? 403 : 400;
    return jsonUtf8({ error: error ?? "缺少用户身份（请先在本站聊天以写入 Cookie）" }, { status });
  }

  const items = readUserMemory(userId);
  return jsonUtf8({ userId, items });
}
