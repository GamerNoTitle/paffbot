import { constantTimeEqual, hmacSha256, toHex, utf8 } from "../lib/crypto";

export interface InitDataUser {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  language_code?: string;
  is_bot?: boolean;
}

export type InitDataCheck =
  | { ok: true; user: InitDataUser; authDate: number }
  | { ok: false; reason: "missing" | "bad_hash" | "expired" | "bad_user" };

/**
 * 校验 Telegram Mini App 的 initData。
 *
 * 官方算法：
 *   secret_key      = HMAC_SHA256(key="WebAppData", data=bot_token)
 *   data_check_string = 所有字段（排序，key=value，\n 连接），**只排除 hash**
 *   hash            = hex(HMAC_SHA256(key=secret_key, data=data_check_string))
 *
 * 注意：Bot API 8.0 起 initData 里多了 signature 字段（Ed25519，给第三方校验用），
 * 它**仍然参与** HMAC 的 data_check_string。老客户端没有这个字段，两种都试一下。
 */
export async function validateInitData(
  initData: string,
  botToken: string,
  maxAgeSeconds = 3600,
): Promise<InitDataCheck> {
  if (!initData) return { ok: false, reason: "missing" };

  let params: URLSearchParams;
  try {
    params = new URLSearchParams(initData);
  } catch {
    return { ok: false, reason: "missing" };
  }

  const providedHash = params.get("hash");
  if (!providedHash) return { ok: false, reason: "missing" };
  params.delete("hash");

  const secretKey = await hmacSha256(utf8("WebAppData"), utf8(botToken));

  let provided: Uint8Array;
  try {
    provided = hexToBytes(providedHash);
  } catch {
    return { ok: false, reason: "bad_hash" };
  }

  // 先按官方口径（包含 signature），再兼容不含 signature 的历史写法
  for (const checkString of dataCheckStrings(params)) {
    const computed = await hmacSha256(secretKey, checkString);
    if (constantTimeEqual(computed, provided)) {
      const authDate = Number.parseInt(params.get("auth_date") ?? "", 10);
      if (!Number.isFinite(authDate)) return { ok: false, reason: "bad_user" };
      const nowSeconds = Math.floor(Date.now() / 1000);
      if (nowSeconds - authDate > maxAgeSeconds) return { ok: false, reason: "expired" };

      const user = parseUser(params.get("user"));
      return user ? { ok: true, user, authDate } : { ok: false, reason: "bad_user" };
    }
  }

  return { ok: false, reason: "bad_hash" };
}

function dataCheckStrings(params: URLSearchParams): string[] {
  const build = (source: URLSearchParams) =>
    [...source.entries()]
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, value]) => `${key}=${value}`)
      .join("\n");

  const withoutSignature = new URLSearchParams(params);
  withoutSignature.delete("signature");

  return [build(params), build(withoutSignature)];
}

function parseUser(raw: string | null): InitDataUser | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<InitDataUser>;
    if (typeof parsed.id !== "number" || !Number.isSafeInteger(parsed.id)) return null;
    return {
      id: parsed.id,
      first_name: typeof parsed.first_name === "string" ? parsed.first_name : "用户",
      last_name: typeof parsed.last_name === "string" ? parsed.last_name : undefined,
      username: typeof parsed.username === "string" ? parsed.username : undefined,
      language_code: typeof parsed.language_code === "string" ? parsed.language_code : undefined,
    };
  } catch {
    return null;
  }
}

function hexToBytes(hex: string): Uint8Array {
  if (hex.length % 2 !== 0 || !/^[0-9a-f]+$/i.test(hex)) throw new Error("non-hex");
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i += 1) out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

/** 仅测试用：按官方口径算 hash（包含 signature 字段）。 */
export async function computeInitDataHash(initData: string, botToken: string): Promise<string> {
  const params = new URLSearchParams(initData);
  params.delete("hash");
  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
  const secretKey = await hmacSha256(utf8("WebAppData"), utf8(botToken));
  return toHex(await hmacSha256(secretKey, dataCheckString));
}
