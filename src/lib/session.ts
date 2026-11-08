/**
 * 浏览器后台的会话 cookie：`<userId>.<过期时间戳>.<签名>`。
 * 签名用 SETTINGS_KEY（没配就用 BOT_TOKEN）做 HMAC，服务端只验签不查库。
 */
const encoder = new TextEncoder();

async function hmacKey(material: string): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", encoder.encode(material), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
    "verify",
  ]);
}

function hex(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export const ADMIN_COOKIE = "paff_admin";

export async function signSession(userId: number, ttlMs: number, material: string): Promise<string> {
  const exp = Date.now() + ttlMs;
  const payload = `${userId}.${exp}`;
  const signature = await crypto.subtle.sign("HMAC", await hmacKey(material), encoder.encode(payload));
  return `${payload}.${hex(signature)}`;
}

export async function verifySession(value: string, material: string): Promise<number | null> {
  const parts = value.split(".");
  if (parts.length !== 3) return null;
  const [rawUser, rawExp, signature] = parts as [string, string, string];
  const userId = Number.parseInt(rawUser, 10);
  const exp = Number.parseInt(rawExp, 10);
  if (!Number.isSafeInteger(userId) || !Number.isSafeInteger(exp)) return null;
  if (exp < Date.now()) return null;

  const expected = await crypto.subtle.sign("HMAC", await hmacKey(material), encoder.encode(`${userId}.${exp}`));
  return hex(expected) === signature ? userId : null;
}

/** 从 Cookie 头里挑出指定名字。 */
export function readCookie(header: string | null, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return decodeURIComponent(rest.join("="));
  }
  return null;
}
