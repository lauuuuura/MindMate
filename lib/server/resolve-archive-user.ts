import { getAnonUserIdFromRequest } from "@/lib/server/anon-user";

/**
 * 档案/记忆读取：默认只信任 Cookie（与当前浏览器会话一致）。
 * 仅在本地开发且设置 ALLOW_DEBUG_USER_ID=1 时，才允许 ?userId= 覆盖（勿在生产开启）。
 */
export function resolveArchiveUserId(req: Request): { userId: string | null; error?: string } {
  const cookieId = getAnonUserIdFromRequest(req);
  if (cookieId) return { userId: cookieId };

  const url = new URL(req.url);
  const queryUserId = url.searchParams.get("userId") ?? "";
  const allowDebug =
    process.env.NODE_ENV === "development" && process.env.ALLOW_DEBUG_USER_ID === "1";

  if (allowDebug && queryUserId.length >= 3) {
    return { userId: queryUserId };
  }

  if (queryUserId.length >= 3 && !allowDebug) {
    return {
      userId: null,
      error:
        "已忽略 ?userId=（防止越权查看他人档案）。请用本站在同一浏览器打开以带上 Cookie，或在 .env.local 设置 ALLOW_DEBUG_USER_ID=1 且 npm run dev 下调试。"
    };
  }

  return {
    userId: null,
    error: "缺少 Cookie mindmate_user_id。请先在首页 http://localhost:3000 聊一句，再访问本接口（同站点才会带上 Cookie）。"
  };
}
