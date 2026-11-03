import { Hono, type Context } from "hono";
import {
  addSshKey,
  deleteSshKey,
  findOpenVerification,
  getVerification,
  listSshKeys,
  listVerifications,
  parseDetail,
  updateVerificationDetail,
  verificationStats,
  type VerificationRow,
} from "../db";
import { appendAudit, listAudit, verifyAuditChain } from "../db/audit";
import { loadConfig, type Env } from "../env";
import { randomToken } from "../lib/crypto";
import { displayName } from "../lib/html";
import { fingerprintOf, parsePublicKeyLine } from "../lib/ssh/keys";
import { TelegramApi } from "../lib/telegram";
import { isGroupAdmin, isSuperAdmin } from "../bot/auth";
import type { BotContext } from "../bot/context";
import { approveVerification } from "../verify/finalize";
import { createProviderRegistry } from "../verify/registry";
import { validateInitData, type InitDataUser } from "./initdata";

export type AppBindings = { Bindings: Env; Variables: { ctx: BotContext } };

export function buildContext(env: Env, origin: string): BotContext {
  const config = loadConfig(env);
  return {
    env,
    config,
    db: env.DB,
    tg: new TelegramApi(config.botToken, config.apiBase),
    providers: createProviderRegistry(config),
    origin,
  };
}

function publicVerification(row: VerificationRow) {
  return {
    id: row.id,
    chatId: row.chat_id,
    chatTitle: row.chat_title,
    source: row.source,
    status: row.status,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    method: row.method,
  };
}

async function readInitUser(c: Context<AppBindings>): Promise<InitDataUser | null> {
  const initData = c.req.header("x-telegram-init-data") ?? "";
  const ctx = c.get("ctx");
  const result = await validateInitData(initData, ctx.config.botToken);
  return result?.user ?? null;
}

export function createApi(): Hono<AppBindings> {
  const api = new Hono<AppBindings>();

  api.use("*", async (c, next) => {
    c.set("ctx", buildContext(c.env, new URL(c.req.url).origin));
    await next();
  });

  api.get("/api/session", async (c) => {
    const user = await readInitUser(c);
    if (!user) return c.json({ ok: false, error: "initData 校验失败，请在 Telegram 内打开" }, 401);
    const ctx = c.get("ctx");

    const open = await findOpenVerification(ctx.db, user.id);
    const keys = await listSshKeys(ctx.db, user.id);

    return c.json({
      ok: true,
      user: { id: user.id, name: displayName({ ...user, id: user.id }) },
      superAdmin: isSuperAdmin(ctx.config, user.id),
      methods: ctx.providers.list().map((p) => ({ id: p.id, label: p.label, description: p.description })),
      ttlSeconds: ctx.config.ttlSeconds,
      keys: keys.map((k) => ({
        fingerprint: k.fingerprint,
        keyType: k.key_type,
        label: k.label,
        createdAt: k.created_at,
        lastUsedAt: k.last_used_at,
      })),
      verification: open ? publicVerification(open) : null,
    });
  });

  api.get("/api/verify/start", async (c) => {
    const user = await readInitUser(c);
    if (!user) return c.json({ ok: false, error: "initData 校验失败" }, 401);
    const ctx = c.get("ctx");

    const method = c.req.query("method") ?? "";
    const provider = ctx.providers.get(method);
    if (!provider) return c.json({ ok: false, error: "未知的验证方式" }, 400);

    const verification = await resolveVerification(ctx, user.id, c.req.query("verificationId"));
    if (!verification) return c.json({ ok: false, error: "没有待完成的验证，请先在群里申请加入" }, 404);

    try {
      const payload = await provider.start({ config: ctx.config, db: ctx.db, verification, user });
      return c.json({ ok: true, method: provider.id, verification: publicVerification(verification), ...payload });
    } catch (err) {
      return c.json({ ok: false, error: err instanceof Error ? err.message : "启动验证失败" }, 400);
    }
  });

  api.post("/api/verify/submit", async (c) => {
    const user = await readInitUser(c);
    if (!user) return c.json({ ok: false, error: "initData 校验失败" }, 401);
    const ctx = c.get("ctx");

    const body = (await safeJson(c.req.raw)) as Record<string, unknown>;
    const method = typeof body.method === "string" ? body.method : "";
    const provider = ctx.providers.get(method);
    if (!provider) return c.json({ ok: false, error: "未知的验证方式" }, 400);

    const verification = await resolveVerification(
      ctx,
      user.id,
      typeof body.verificationId === "string" ? body.verificationId : undefined,
    );
    if (!verification) return c.json({ ok: false, error: "没有待完成的验证" }, 404);

    const detail = parseDetail(verification.detail);
    const failed = typeof detail.failed_attempts === "number" ? detail.failed_attempts : 0;
    if (failed >= 20) {
      return c.json({ ok: false, error: "失败次数过多，请联系群管理员" }, 429);
    }

    const result = await provider.submit({ config: ctx.config, db: ctx.db, verification, user }, body);

    if (!result.ok) {
      await updateVerificationDetail(ctx.db, verification.id, {
        failed_attempts: failed + 1,
        last_error: result.error,
      });
      await appendAudit(ctx.db, {
        actorId: user.id,
        actorType: "user",
        action: "verification.failed",
        chatId: verification.chat_id,
        targetUserId: user.id,
        verificationId: verification.id,
        detail: { method, error: result.error },
      });
      return c.json({ ok: false, error: result.error }, 400);
    }

    const approved = await approveVerification({ db: ctx.db, tg: ctx.tg }, verification, {
      method: provider.id,
      actorId: user.id,
      actorType: "user",
      proof: result.proof,
    });

    if (!approved) return c.json({ ok: false, error: "这条验证刚刚已被处理，请刷新" }, 409);

    return c.json({ ok: true, approved: true, chatTitle: verification.chat_title });
  });

  api.post("/api/verify/ssh/keys", async (c) => {
    const user = await readInitUser(c);
    if (!user) return c.json({ ok: false, error: "initData 校验失败" }, 401);
    const ctx = c.get("ctx");

    const body = (await safeJson(c.req.raw)) as Record<string, unknown>;
    const publicKey = typeof body.publicKey === "string" ? body.publicKey : "";
    const label = typeof body.label === "string" ? body.label.slice(0, 64) : null;
    if (!publicKey) return c.json({ ok: false, error: "公钥为空" }, 400);

    let parsed;
    try {
      parsed = parsePublicKeyLine(publicKey);
    } catch (err) {
      return c.json({ ok: false, error: err instanceof Error ? err.message : "公钥格式不对" }, 400);
    }

    const existing = await listSshKeys(ctx.db, user.id);
    const fingerprint = await fingerprintOf(parsed.blob);
    if (!existing.some((k) => k.fingerprint === fingerprint) && existing.length >= 5) {
      return c.json({ ok: false, error: "每个账号最多登记 5 把公钥，请先删除不用的" }, 400);
    }

    await addSshKey(ctx.db, {
      id: crypto.randomUUID(),
      userId: user.id,
      fingerprint,
      keyType: parsed.type,
      publicKey: publicKey.trim(),
      label,
    });

    await appendAudit(ctx.db, {
      actorId: user.id,
      actorType: "user",
      action: "ssh_key.added",
      chatId: null,
      targetUserId: user.id,
      verificationId: null,
      detail: { fingerprint, keyType: parsed.type, label },
    });

    return c.json({ ok: true, fingerprint, keyType: parsed.type });
  });

  api.post("/api/verify/ssh/keys/delete", async (c) => {
    const user = await readInitUser(c);
    if (!user) return c.json({ ok: false, error: "initData 校验失败" }, 401);
    const ctx = c.get("ctx");

    const body = (await safeJson(c.req.raw)) as Record<string, unknown>;
    const fingerprint = typeof body.fingerprint === "string" ? body.fingerprint : "";
    if (!fingerprint) return c.json({ ok: false, error: "缺少指纹" }, 400);

    const removed = await deleteSshKey(ctx.db, user.id, fingerprint);
    if (removed) {
      await appendAudit(ctx.db, {
        actorId: user.id,
        actorType: "user",
        action: "ssh_key.deleted",
        chatId: null,
        targetUserId: user.id,
        verificationId: null,
        detail: { fingerprint },
      });
    }
    return c.json({ ok: removed });
  });

  // ------------------------------------------------------------ 审计（管理者）

  api.get("/api/audit/overview", async (c) => {
    const ctx = c.get("ctx");
    const auth = await authorizeAudit(c, ctx);
    if ("error" in auth) return c.json({ ok: false, error: auth.error }, auth.status);

    const chatId = auth.chatId;
    const [stats, chain, recent, verifications] = await Promise.all([
      verificationStats(ctx.db, chatId ?? undefined),
      verifyAuditChain(ctx.db, 2000),
      listAudit(ctx.db, { chatId: chatId ?? undefined, limit: 20 }),
      listVerifications(ctx.db, { chatId: chatId ?? undefined, limit: 20 }),
    ]);

    return c.json({
      ok: true,
      chatId: chatId ?? null,
      superAdmin: auth.superAdmin,
      stats,
      chain,
      audit: recent.rows.map(serializeAudit),
      auditTotal: recent.total,
      verifications: verifications.rows.map((row) => ({
        ...publicVerification(row),
        userId: row.user_id,
        userName: row.display_name ?? row.username,
        status: row.status,
        method: row.method,
        reason: row.reason,
        operatorId: row.operator_id,
        decidedAt: row.decided_at,
        detail: parseDetail(row.detail),
      })),
      verificationsTotal: verifications.total,
    });
  });

  api.get("/api/audit/log", async (c) => {
    const ctx = c.get("ctx");
    const auth = await authorizeAudit(c, ctx);
    if ("error" in auth) return c.json({ ok: false, error: auth.error }, auth.status);

    const limit = Number.parseInt(c.req.query("limit") ?? "50", 10);
    const offset = Number.parseInt(c.req.query("offset") ?? "0", 10);
    const { rows, total } = await listAudit(ctx.db, {
      chatId: auth.chatId ?? undefined,
      action: c.req.query("action") ?? undefined,
      limit: Number.isFinite(limit) ? limit : 50,
      offset: Number.isFinite(offset) ? offset : 0,
    });
    return c.json({ ok: true, total, rows: rows.map(serializeAudit) });
  });

  api.get("/api/audit/verifications", async (c) => {
    const ctx = c.get("ctx");
    const auth = await authorizeAudit(c, ctx);
    if ("error" in auth) return c.json({ ok: false, error: auth.error }, auth.status);

    const limit = Number.parseInt(c.req.query("limit") ?? "50", 10);
    const offset = Number.parseInt(c.req.query("offset") ?? "0", 10);
    const { rows, total } = await listVerifications(ctx.db, {
      chatId: auth.chatId ?? undefined,
      userId: parseOptionalInt(c.req.query("userId")),
      status: c.req.query("status") ?? undefined,
      limit: Number.isFinite(limit) ? limit : 50,
      offset: Number.isFinite(offset) ? offset : 0,
    });

    return c.json({
      ok: true,
      total,
      rows: rows.map((row) => ({
        ...publicVerification(row),
        userId: row.user_id,
        userName: row.display_name ?? row.username,
        reason: row.reason,
        operatorId: row.operator_id,
        decidedAt: row.decided_at,
        detail: parseDetail(row.detail),
      })),
    });
  });

  api.get("/api/audit/export.csv", async (c) => {
    const ctx = c.get("ctx");
    const auth = await authorizeAudit(c, ctx);
    if ("error" in auth) return c.json({ ok: false, error: auth.error }, auth.status);

    const rows: VerificationRow[] = [];
    const pageSize = 200;
    for (let offset = 0; offset < 5000; offset += pageSize) {
      const page = await listVerifications(ctx.db, {
        chatId: auth.chatId ?? undefined,
        limit: pageSize,
        offset,
      });
      rows.push(...page.rows);
      if (page.rows.length < pageSize || rows.length >= page.total) break;
    }
    const header = [
      "verification_id",
      "chat_id",
      "user_id",
      "username",
      "display_name",
      "status",
      "source",
      "method",
      "reason",
      "operator_id",
      "created_at",
      "decided_at",
    ];
    const lines = [header.join(",")];
    for (const row of rows) {
      lines.push(
        [
          row.id,
          row.chat_id,
          row.user_id,
          row.username ?? "",
          row.display_name ?? "",
          row.status,
          row.source,
          row.method ?? "",
          row.reason ?? "",
          row.operator_id ?? "",
          new Date(row.created_at).toISOString(),
          row.decided_at ? new Date(row.decided_at).toISOString() : "",
        ]
          .map(csvCell)
          .join(","),
      );
    }
    return new Response("\uFEFF" + lines.join("\r\n"), {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="paffbot-verifications-${auth.chatId ?? "all"}.csv"`,
      },
    });
  });

  return api;
}

async function resolveVerification(ctx: BotContext, userId: number, verificationId?: string): Promise<VerificationRow | null> {
  if (verificationId) {
    const row = await getVerification(ctx.db, verificationId);
    if (!row || row.user_id !== userId) return null;
    return row.status === "pending" ? row : null;
  }
  return findOpenVerification(ctx.db, userId);
}

async function authorizeAudit(
  c: Context<AppBindings>,
  ctx: BotContext,
): Promise<{ error: string; status: 401 | 403 } | { superAdmin: boolean; chatId: number | null }> {
  const chatIdRaw = c.req.query("chatId");
  const chatId = chatIdRaw ? Number.parseInt(chatIdRaw, 10) : null;

  const authHeader = c.req.header("authorization") ?? "";
  if (ctx.config.adminToken && authHeader === `Bearer ${ctx.config.adminToken}`) {
    return { superAdmin: true, chatId: Number.isSafeInteger(chatId) ? chatId : null };
  }

  const user = await readInitUser(c);
  if (!user) return { error: "initData 校验失败", status: 401 };

  if (isSuperAdmin(ctx.config, user.id)) {
    return { superAdmin: true, chatId: Number.isSafeInteger(chatId) ? chatId : null };
  }
  if (!chatId || !Number.isSafeInteger(chatId)) {
    return { error: "需要指定 chatId（只有超管能看全量）", status: 403 };
  }
  const admin = await isGroupAdmin({ config: ctx.config, db: ctx.db, tg: ctx.tg }, chatId, user.id);
  if (!admin) return { error: "你不是该群管理员", status: 403 };
  return { superAdmin: false, chatId };
}

function serializeAudit(row: {
  id: number;
  ts: number;
  actor_id: number;
  actor_type: string;
  action: string;
  chat_id: number | null;
  target_user_id: number | null;
  verification_id: string | null;
  detail: string | null;
}) {
  let detail: unknown = null;
  if (row.detail) {
    try {
      detail = JSON.parse(row.detail);
    } catch {
      detail = row.detail;
    }
  }
  return {
    id: row.id,
    ts: row.ts,
    actorId: row.actor_id,
    actorType: row.actor_type,
    action: row.action,
    chatId: row.chat_id,
    targetUserId: row.target_user_id,
    verificationId: row.verification_id,
    detail,
  };
}

function parseOptionalInt(raw: string | undefined): number | undefined {
  if (!raw) return undefined;
  const parsed = Number.parseInt(raw, 10);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}

function csvCell(value: unknown): string {
  const text = String(value ?? "");
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

async function safeJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return {};
  }
}

export function newNonce(): string {
  return randomToken(16);
}
