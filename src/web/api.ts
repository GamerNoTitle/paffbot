import { Hono, type Context } from "hono";
import {
  consumeDailyQuota,
  findOpenVerification,
  getVerification,
  listVerifications,
  parseDetail,
  updateVerificationDetail,
  verificationStats,
  type VerificationRow,
} from "../db";
import { appendAudit, listAudit, verifyAuditChain } from "../db/audit";
import { loadConfig, type Env } from "../env";
import { consumeChallenge, issueChallenge, readChallenge } from "../lib/challenge";
import { isValidGithubUsername, normalizeGithubUsername } from "../lib/github";
import { verifyGithubOwnership } from "../verify/github-verify";
import { randomToken } from "../lib/crypto";
import { displayName } from "../lib/html";
import { TelegramApi } from "../lib/telegram";
import { isGroupAdmin, isSuperAdmin } from "../bot/auth";
import type { BotContext } from "../bot/context";
import { approveVerification } from "../verify/finalize";
import { createProviderRegistry } from "../verify/registry";
import { botUsername } from "../bot/identity";
import { validateInitData, type InitDataUser } from "./initdata";

export type AppBindings = { Bindings: Env; Variables: { ctx: BotContext } };

export function buildContext(env: Env, origin: string): BotContext {
  const config = loadConfig(env);
  return {
    env,
    config,
    db: env.DB,
    tg: new TelegramApi(config.botToken, config.apiBase),
    providers: createProviderRegistry(),
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

async function readInitUser(c: Context<AppBindings>): Promise<{ user: InitDataUser | null; reason: string }> {
  const initData = c.req.header("x-telegram-init-data") ?? "";
  const ctx = c.get("ctx");
  const result = await validateInitData(initData, ctx.config.botToken);
  return result.ok ? { user: result.user, reason: "" } : { user: null, reason: result.reason };
}

export function createApi(): Hono<AppBindings> {
  const api = new Hono<AppBindings>();

  api.use("*", async (c, next) => {
    c.set("ctx", buildContext(c.env, new URL(c.req.url).origin));
    await next();
  });

  api.get("/api/session", async (c) => {
    const auth = await readInitUser(c);
    if (!auth.user) return c.json({ ok: false, error: `initData 校验失败（${auth.reason}）` }, 401);
    const user = auth.user;
    const ctx = c.get("ctx");

    const open = await findOpenVerification(ctx.db, user.id);

    return c.json({
      ok: true,
      user: { id: user.id, name: displayName({ ...user, id: user.id }) },
      superAdmin: isSuperAdmin(ctx.config, user.id),
      botUsername: await botUsername(ctx.tg),
      methods: ctx.providers.list().map((p) => ({ id: p.id, label: p.label, description: p.description })),
      ttlSeconds: ctx.config.ttlSeconds,
      verification: open ? publicVerification(open) : null,
    });
  });

  api.get("/api/verify/start", async (c) => {
    const auth = await readInitUser(c);
    if (!auth.user) return c.json({ ok: false, error: `initData 校验失败（${auth.reason}）` }, 401);
    const user = auth.user;
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
    const auth = await readInitUser(c);
    if (!auth.user) return c.json({ ok: false, error: `initData 校验失败（${auth.reason}）` }, 401);
    const user = auth.user;
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

  // ------------------------------------------------ 浏览器独立校验（无 Telegram）

  /** 签发一次性挑战，供浏览器直接跑 GitHub 签名校验（不会放行任何群）。 */
  api.get("/api/github/challenge", async (c) => {
    const ctx = c.get("ctx");
    const quota = await consumeDailyQuota(ctx.db, `ip:${clientIp(c)}`, ctx.config.dailyAttempts);
    if (!quota.allowed) {
      return c.json(
        { ok: false, error: "今天尝试的太多了，明天再来吧！", remaining: 0 },
        429,
      );
    }
    const issued = await issueChallenge(ctx.config, ctx.db, clientIp(c));
    return c.json({ ok: true, ...issued, remaining: quota.limit - quota.used });
  });

  api.post("/api/github/check", async (c) => {
    const ctx = c.get("ctx");
    const body = (await safeJson(c.req.raw)) as Record<string, unknown>;

    const username = normalizeGithubUsername(typeof body.username === "string" ? body.username : "");
    const signature = typeof body.signature === "string" ? body.signature.trim() : "";
    const token = typeof body.token === "string" ? body.token : "";

    if (!isValidGithubUsername(username)) return c.json({ ok: false, error: "GitHub 用户名格式不正确" }, 400);
    if (!signature) return c.json({ ok: false, error: "请粘贴签名结果" }, 400);
    if (!signature.includes("BEGIN SSH SIGNATURE")) {
      return c.json({ ok: false, error: "这不是 SSHSIG 签名（缺少 BEGIN SSH SIGNATURE 标记）" }, 400);
    }
    if (signature.length > 20_000) return c.json({ ok: false, error: "签名内容过长" }, 400);

    const claim = await readChallenge(ctx.config, token);
    if (!claim) return c.json({ ok: false, error: "校验已失效，刷新页面重新来" }, 400);
    if (!(await consumeChallenge(ctx.db, claim.nonce))) {
      return c.json({ ok: false, error: "这次校验已经用过了，刷新页面重新来" }, 409);
    }

    const result = await verifyGithubOwnership(ctx.config, username, signature, claim.challenge);
    if (!result.ok) return c.json({ ok: false, error: result.error ?? "校验失败" }, 400);

    return c.json({
      ok: true,
      githubUsername: username,
      fingerprint: result.fingerprint,
      keyType: result.keyType,
      namespace: result.namespace,
    });
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

  const auth = await readInitUser(c);
  if (!auth.user) return { error: `initData 校验失败（${auth.reason}）`, status: 401 };
  const user = auth.user;

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

function clientIp(c: Context<AppBindings>): string {
  const direct = c.req.header("cf-connecting-ip");
  if (direct) return direct;
  const forwarded = c.req.header("x-forwarded-for");
  return forwarded?.split(",")[0]?.trim() || "local";
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
