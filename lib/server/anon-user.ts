const COOKIE_NAME = "mindmate_user_id";

/** 从请求 Cookie 读取匿名用户 ID（与前端 `lib/anon-user.ts` 写入的 cookie 名一致） */
export function getAnonUserIdFromRequest(req: Request): string | null {
  const header = req.headers.get("cookie");
  if (!header) return null;
  const parts = header.split(";").map((p) => p.trim());
  for (const p of parts) {
    if (!p.startsWith(`${COOKIE_NAME}=`)) continue;
    const raw = p.slice(COOKIE_NAME.length + 1);
    try {
      const v = decodeURIComponent(raw);
      return v.length >= 3 ? v : null;
    } catch {
      return raw.length >= 3 ? raw : null;
    }
  }
  return null;
}

/**
 * 优先使用 Cookie 中的 userId（与浏览器持久化一致），否则使用 body 中的字段。
 */
export function resolveUserId(req: Request, bodyUserId: string): string {
  const fromCookie = getAnonUserIdFromRequest(req);
  if (fromCookie) return fromCookie;
  return bodyUserId;
}
