const KEY = "mindmate_user_id";

function createUserId() {
  const random = Math.random().toString(36).slice(2, 12);
  return `anon_${Date.now()}_${random}`;
}

export function getOrCreateAnonUserId() {
  if (typeof window === "undefined") return "";
  let userId = window.localStorage.getItem(KEY);
  if (!userId) {
    userId = createUserId();
    window.localStorage.setItem(KEY, userId);
  }
  const expires = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toUTCString();
  document.cookie = `${KEY}=${userId}; expires=${expires}; path=/; SameSite=Lax`;
  return userId;
}
