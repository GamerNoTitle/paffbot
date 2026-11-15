import { sha256Hex, stableStringify } from "../lib/crypto";
import { nowMs } from "../lib/time";

/**
 * 审计日志：append-only + 哈希链。
 *
 * hash = sha256(prev_hash + 本条记录的全部字段)，因此事后删掉/改动任意一条，
 * 后面的链就对不上。verifyAuditChain() 可以从头重算并指出断点。
 */

export type ActorType = "super_admin" | "group_admin" | "system" | "user";

export interface AuditInput {
  actorId: number;
  actorType: ActorType;
  action: string;
  chatId?: number | null;
  targetUserId?: number | null;
  verificationId?: string | null;
  detail?: Record<string, unknown> | null;
}

export interface AuditRow {
  chat_title?: string | null;
  id: number;
  ts: number;
  actor_id: number;
  actor_type: ActorType;
  action: string;
  chat_id: number | null;
  target_user_id: number | null;
  verification_id: string | null;
  detail: string | null;
  prev_hash: string;
  hash: string;
}

export const GENESIS_HASH = "0".repeat(64);

function canonical(parts: {
  ts: number;
  actorId: number;
  actorType: string;
  action: string;
  chatId: number | null;
  targetUserId: number | null;
  verificationId: string | null;
  detail: string | null;
}): string {
  return [
    parts.ts,
    parts.actorId,
    parts.actorType,
    parts.action,
    parts.chatId ?? "",
    parts.targetUserId ?? "",
    parts.verificationId ?? "",
    parts.detail ?? "",
  ].join("\n");
}

export async function appendAudit(db: D1Database, input: AuditInput): Promise<string> {
  const prev = await db.prepare("SELECT hash FROM audit_log ORDER BY id DESC LIMIT 1").first<{ hash: string }>();
  const prevHash = prev?.hash ?? GENESIS_HASH;
  const ts = nowMs();
  const detail = input.detail ? stableStringify(input.detail) : null;
  const hash = await sha256Hex(
    prevHash +
      "\n" +
      canonical({
        ts,
        actorId: input.actorId,
        actorType: input.actorType,
        action: input.action,
        chatId: input.chatId ?? null,
        targetUserId: input.targetUserId ?? null,
        verificationId: input.verificationId ?? null,
        detail,
      }),
  );

  await db
    .prepare(
      `INSERT INTO audit_log
        (ts, actor_id, actor_type, action, chat_id, target_user_id, verification_id, detail, prev_hash, hash)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      ts,
      input.actorId,
      input.actorType,
      input.action,
      input.chatId ?? null,
      input.targetUserId ?? null,
      input.verificationId ?? null,
      detail,
      prevHash,
      hash,
    )
    .run();

  return hash;
}

export interface AuditFilter {
  chatId?: number;
  targetUserId?: number;
  action?: string;
  query?: string;
  limit?: number;
  offset?: number;
}

export async function listAudit(db: D1Database, filter: AuditFilter = {}): Promise<{ rows: AuditRow[]; total: number }> {
  const where: string[] = [];
  const params: (string | number)[] = [];
  if (filter.chatId) {
    where.push("a.chat_id = ?");
    params.push(filter.chatId);
  }
  if (filter.targetUserId) {
    where.push("a.target_user_id = ?");
    params.push(filter.targetUserId);
  }
  if (filter.action) {
    where.push("a.action = ?");
    params.push(filter.action);
  }
  if (filter.query) {
    const q = `%${filter.query}%`;
    where.push(
      "(a.action LIKE ? OR CAST(a.target_user_id AS TEXT) LIKE ? OR CAST(a.actor_id AS TEXT) LIKE ? OR a.detail LIKE ?)",
    );
    params.push(q, q, q, q);
  }
  const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const limit = Math.min(500, Math.max(1, filter.limit ?? 50));
  const offset = Math.max(0, filter.offset ?? 0);

  const totalRow = await db
    .prepare(`SELECT COUNT(*) AS total FROM audit_log a ${clause}`)
    .bind(...params)
    .first<{ total: number }>();
  const { results } = await db
    .prepare(
      `SELECT a.*, g.title AS chat_title FROM audit_log a
       LEFT JOIN groups g ON g.chat_id = a.chat_id
       ${clause} ORDER BY a.id DESC LIMIT ? OFFSET ?`,
    )
    .bind(...params, limit, offset)
    .all<AuditRow & { chat_title: string | null }>();

  return { rows: results ?? [], total: totalRow?.total ?? 0 };
}
export interface ChainVerification {
  ok: boolean;
  checked: number;
  brokenAtId: number | null;
}

/**
 * 链校验的检查点：记住「校验到哪一行、那一行的 hash」。
 *
 * 重点是别每次都从第一行重算——每一行要一次 SHA-256，2000 行就是 2000 次
 * 加密调用，在免费套餐 10ms CPU 预算下必然超限。存了检查点之后，
 * 常态只校验自上次以来的新增行（通常 0～几条）。
 */
const CHAIN_CACHE_TTL_MS = 60_000;
let chainCache: { at: number; result: ChainVerification } | null = null;

async function readCheckpoint(db: D1Database): Promise<{ throughId: number; hash: string } | null> {
  try {
    const row = await db
      .prepare("SELECT through_id, hash FROM audit_chain WHERE id = 1")
      .first<{ through_id: number; hash: string }>();
    return row ? { throughId: row.through_id, hash: row.hash } : null;
  } catch {
    // 表还没建（老库）：当作没有检查点，走全量
    return null;
  }
}

async function writeCheckpoint(db: D1Database, throughId: number, hash: string): Promise<void> {
  try {
    await db
      .prepare(
        `INSERT INTO audit_chain (id, through_id, hash, updated_at) VALUES (1, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET through_id = excluded.through_id, hash = excluded.hash, updated_at = excluded.updated_at`,
      )
      .bind(throughId, hash, Date.now())
      .run();
  } catch {
    /* 检查点写不进去不影响校验本身 */
  }
}

async function clearCheckpoint(db: D1Database): Promise<void> {
  try {
    await db.prepare("DELETE FROM audit_chain WHERE id = 1").run();
  } catch {
    /* ignore */
  }
}

/** 从某个 hash 开始，按 id 升序校验，边校验边推进检查点。 */
async function walk(
  db: D1Database,
  fromId: number,
  fromHash: string,
  batchSize: number,
  persist: boolean,
): Promise<ChainVerification> {
  let prevId = fromId;
  let prevHash = fromHash;
  let checked = 0;

  for (;;) {
    const { results } = await db
      .prepare("SELECT * FROM audit_log WHERE id > ? ORDER BY id ASC LIMIT ?")
      .bind(prevId, batchSize)
      .all<AuditRow>();

    const rows = results ?? [];
    if (rows.length === 0) break;

    for (const row of rows) {
      const expected = await sha256Hex(
        prevHash +
          "\n" +
          canonical({
            ts: row.ts,
            actorId: row.actor_id,
            actorType: row.actor_type,
            action: row.action,
            chatId: row.chat_id,
            targetUserId: row.target_user_id,
            verificationId: row.verification_id,
            detail: row.detail,
          }),
      );
      checked += 1;
      if (row.prev_hash !== prevHash || row.hash !== expected) {
        return { ok: false, checked, brokenAtId: row.id };
      }
      prevHash = row.hash;
      prevId = row.id;
    }

    if (persist) await writeCheckpoint(db, prevId, prevHash);
    if (rows.length < batchSize) break;
  }

  return { ok: true, checked, brokenAtId: null };
}

/** 逐条校验哈希链。有检查点时只校验新增行，否则从头来一遍并落检查点。 */
export async function verifyAuditChain(db: D1Database, batchSize = 200): Promise<ChainVerification> {
  // 单批最多 200 行：一批就是 200 次 SHA-256，再多容易撞免费套餐的 CPU 上限
  batchSize = Math.min(200, Math.max(20, batchSize));
  if (chainCache && Date.now() - chainCache.at < CHAIN_CACHE_TTL_MS) return chainCache.result;

  const checkpoint = await readCheckpoint(db);

  // 检查点那行还在、hash 没变，就从它之后继续
  if (checkpoint) {
    const still = await db
      .prepare("SELECT hash FROM audit_log WHERE id = ?")
      .bind(checkpoint.throughId)
      .first<{ hash: string }>();
    if (still && still.hash === checkpoint.hash) {
      const result = await walk(db, checkpoint.throughId, checkpoint.hash, batchSize, true);
      chainCache = { at: Date.now(), result };
      return result;
    }
    // 历史被改写（例如手动清理过记录）：丢掉检查点重新全量校验
    await clearCheckpoint(db);
  }

  const result = await walk(db, 0, GENESIS_HASH, batchSize, true);
  chainCache = { at: Date.now(), result };
  return result;
}
