import type { Config } from "../env";
import { constantTimeEqual, fromBase64Url, hmacSha256, randomToken, sha256, toBase64Url, utf8 } from "../lib/crypto";
import { nowMs } from "./time";

/**
 * 浏览器独立校验用的一次性挑战：
 *   - nonce 落库（challenges 表），校验时原子消费，重放直接失败
 *   - token 是无状态 HMAC，只承载 nonce，避免信任客户端提交的挑战串
 *
 * payload = { n: nonce, e: 过期时间(ms) }
 * 有效期与 Telegram 流程一致，取 VERIFY_TTL_SECONDS（默认 300 秒）。
 */

async function signingKey(config: Config): Promise<Uint8Array> {
  return sha256(utf8(`paffbot-challenge:${config.botToken}:${config.webhookSecret}`));
}

export interface IssuedChallenge {
  challenge: string;
  token: string;
  expiresAt: number;
}

export function challengeForNonce(nonce: string): string {
  return `paffbot-check:v1:${nonce}`;
}

export async function issueChallenge(
  config: Config,
  db: D1Database,
  ip: string,
): Promise<IssuedChallenge> {
  const nonce = randomToken(18);
  const challenge = challengeForNonce(nonce);
  const expiresAt = nowMs() + config.ttlSeconds * 1000;

  await db
    .prepare("INSERT INTO challenges (nonce, ip, created_at, expires_at, used_at) VALUES (?, ?, ?, ?, NULL)")
    .bind(nonce, ip, nowMs(), expiresAt)
    .run();

  const body = toBase64Url(utf8(JSON.stringify({ n: nonce, e: expiresAt })));
  const signature = toBase64Url(await hmacSha256(await signingKey(config), body));
  return { challenge, token: `${body}.${signature}`, expiresAt };
}

export interface ChallengeClaim {
  nonce: string;
  challenge: string;
}

export async function readChallenge(config: Config, token: string): Promise<ChallengeClaim | null> {
  const [body, signature] = token.split(".");
  if (!body || !signature) return null;

  const expected = await hmacSha256(await signingKey(config), body);
  if (!constantTimeEqual(expected, fromBase64Url(signature))) return null;

  try {
    const payload = JSON.parse(new TextDecoder().decode(fromBase64Url(body))) as { n?: unknown; e?: unknown };
    if (typeof payload.n !== "string" || typeof payload.e !== "number") return null;
    if (payload.e < nowMs()) return null;
    return { nonce: payload.n, challenge: challengeForNonce(payload.n) };
  } catch {
    return null;
  }
}

/**
 * 原子消费 nonce：只有「未使用且未过期」的才返回 true。
 * 先消费再验签，失败的尝试也会烧掉 nonce。
 */
export async function consumeChallenge(db: D1Database, nonce: string): Promise<boolean> {
  const now = nowMs();
  const result = await db
    .prepare("UPDATE challenges SET used_at = ? WHERE nonce = ? AND used_at IS NULL AND expires_at > ?")
    .bind(now, nonce, now)
    .run();
  return (result.meta.changes ?? 0) > 0;
}

export async function pruneChallenges(db: D1Database, keepMs = 24 * 3600 * 1000): Promise<number> {
  const result = await db.prepare("DELETE FROM challenges WHERE expires_at < ?").bind(nowMs() - keepMs).run();
  return result.meta.changes ?? 0;
}
