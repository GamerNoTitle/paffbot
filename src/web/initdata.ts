import { constantTimeEqual, hmacSha256, toHex, utf8 } from "../lib/crypto";

export interface InitDataUser {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  language_code?: string;
  is_bot?: boolean;
}

export interface InitDataResult {
  user: InitDataUser;
  authDate: number;
}

/**
 * 校验 Telegram Mini App 的 initData。
 *
 * 关键点：user_id 必须来自这里验过签的 user 字段，绝不能信前端 body 里传来的 id。
 * secret = HMAC_SHA256(key="WebAppData", data=bot_token)
 * hash   = HMAC_SHA256(key=secret, data=data_check_string)
 */
export async function validateInitData(
  initData: string,
  botToken: string,
  maxAgeSeconds = 3600,
): Promise<InitDataResult | null> {
  if (!initData) return null;

  let params: URLSearchParams;
  try {
    params = new URLSearchParams(initData);
  } catch {
    return null;
  }

  const providedHash = params.get("hash");
  if (!providedHash) return null;
  params.delete("hash");
  params.delete("signature");

  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");

  const secretKey = await hmacSha256(utf8("WebAppData"), utf8(botToken));
  const computed = await hmacSha256(secretKey, dataCheckString);

  let provided: Uint8Array;
  try {
    provided = hexToBytes(providedHash);
  } catch {
    return null;
  }
  if (!constantTimeEqual(computed, provided)) return null;

  const authDate = Number.parseInt(params.get("auth_date") ?? "", 10);
  if (!Number.isFinite(authDate)) return null;
  const nowSeconds = Math.floor(Date.now() / 1000);
  if (nowSeconds - authDate > maxAgeSeconds) return null;

  const userJson = params.get("user");
  if (!userJson) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(userJson);
  } catch {
    return null;
  }
  const candidate = parsed as Partial<InitDataUser>;
  if (typeof candidate.id !== "number" || !Number.isSafeInteger(candidate.id)) return null;

  return {
    user: {
      id: candidate.id,
      first_name: typeof candidate.first_name === "string" ? candidate.first_name : "用户",
      last_name: typeof candidate.last_name === "string" ? candidate.last_name : undefined,
      username: typeof candidate.username === "string" ? candidate.username : undefined,
      language_code: typeof candidate.language_code === "string" ? candidate.language_code : undefined,
    },
    authDate,
  };
}

function hexToBytes(hex: string): Uint8Array {
  if (hex.length % 2 !== 0 || !/^[0-9a-f]+$/i.test(hex)) throw new Error("non-hex");
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i += 1) out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

/** 仅用于测试/日志：把 HMAC 结果转成 hex。 */
export async function computeInitDataHash(initData: string, botToken: string): Promise<string> {
  const params = new URLSearchParams(initData);
  params.delete("hash");
  params.delete("signature");
  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
  const secretKey = await hmacSha256(utf8("WebAppData"), utf8(botToken));
  return toHex(await hmacSha256(secretKey, dataCheckString));
}
