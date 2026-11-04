import type { Config } from "../env";
import { constantTimeEqual, fromBase64Url, hmacSha256, randomToken, sha256, toBase64Url, utf8 } from "../lib/crypto";

/**
 * 浏览器独立校验用的一次性挑战令牌：
 *   token = base64url(payload) + "." + base64url(HMAC(key, payload))
 *   payload = { c: challenge, e: 过期时间(ms) }
 *
 * 无状态、不落库；密钥由 BOT_TOKEN + WEBHOOK_SECRET 派生，换密钥即全部失效。
 */

const TTL_MS = 10 * 60 * 1000;

async function signingKey(config: Config): Promise<Uint8Array> {
  return sha256(utf8(`paffbot-challenge:${config.botToken}:${config.webhookSecret}`));
}

export interface IssuedChallenge {
  challenge: string;
  token: string;
  expiresAt: number;
}

export async function issueChallenge(config: Config): Promise<IssuedChallenge> {
  const challenge = `paffbot-check:v1:${randomToken(24)}`;
  const expiresAt = Date.now() + TTL_MS;
  const body = toBase64Url(utf8(JSON.stringify({ c: challenge, e: expiresAt })));
  const signature = toBase64Url(await hmacSha256(await signingKey(config), body));
  return { challenge, token: `${body}.${signature}`, expiresAt };
}

export async function readChallenge(config: Config, token: string): Promise<string | null> {
  const [body, signature] = token.split(".");
  if (!body || !signature) return null;

  const expected = await hmacSha256(await signingKey(config), body);
  if (!constantTimeEqual(expected, fromBase64Url(signature))) return null;

  try {
    const payload = JSON.parse(new TextDecoder().decode(fromBase64Url(body))) as { c?: unknown; e?: unknown };
    if (typeof payload.c !== "string" || typeof payload.e !== "number") return null;
    if (payload.e < Date.now()) return null;
    return payload.c;
  } catch {
    return null;
  }
}
