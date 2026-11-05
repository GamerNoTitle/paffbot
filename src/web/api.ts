import { Hono, type Context } from "hono";
import {
  consumeDailyQuota,
  getGroupPhoto,
  setGroupPhoto,
  consumeOAuthState,
  createOAuthState,
  getGithubAccount,
  upsertGithubAccount,
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
import { TelegramApi, type TgChat, type TgFile } from "../lib/telegram";
import { isGroupAdmin, isSuperAdmin } from "../bot/auth";
import type { BotContext } from "../bot/context";
import { approveVerification } from "../verify/finalize";
import { createProviderRegistry } from "../verify/registry";
import {
  authorizeUrl,
  exchangeCode,
  fetchGithubAccount,
  oauthEnabled,
} from "../lib/github-oauth";
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
    if (!auth.user) return c.json({ ok: false, error: `没拿到 Telegram 的登录信息（${auth.reason}），请从 Telegram 里打开` }, 401);
    const user = auth.user;
    const ctx = c.get("ctx");

    const open = await findOpenVerification(ctx.db, user.id);
    const bound = await getGithubAccount(ctx.db, user.id);

    return c.json({
      ok: true,
      user: { id: user.id, name: displayName({ ...user, id: user.id }) },
      superAdmin: isSuperAdmin(ctx.config, user.id),
      botUsername: await botUsername(ctx.tg),
      oauth: { enabled: oauthEnabled(ctx.config) },
      github: bound ? { login: bound.github_login } : null,
      methods: ctx.providers.list().map((p) => ({ id: p.id, label: p.label, description: p.description })),
      ttlSeconds: ctx.config.ttlSeconds,
      verification: open ? { ...publicVerification(open), chatPhoto: `/api/group/photo/${open.chat_id}` } : null,
    });
  });

  api.get("/api/verify/start", async (c) => {
    const auth = await readInitUser(c);
    if (!auth.user) return c.json({ ok: false, error: `没拿到 Telegram 的登录信息（${auth.reason}），请从 Telegram 里打开` }, 401);
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
      return c.json({ ok: false, error: err instanceof Error ? err.message : "没能开始验证" }, 400);
    }
  });

  api.post("/api/verify/submit", async (c) => {
    const auth = await readInitUser(c);
    if (!auth.user) return c.json({ ok: false, error: `没拿到 Telegram 的登录信息（${auth.reason}），请从 Telegram 里打开` }, 401);
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

    if (!approved) return c.json({ ok: false, error: "这条验证刚刚已经处理过了，刷新看看" }, 409);

    // 签名同样能证明账号归属，顺手建立绑定（OAuth 会补上 github_id）
    const login = (result.proof as { githubUsername?: string } | undefined)?.githubUsername;
    if (typeof login === "string" && login) {
      await upsertGithubAccount(ctx.db, user.id, login, null, "signature");
    }

    return c.json({ ok: true, approved: true, chatTitle: verification.chat_title });
  });

  /** GitHub 头像：走服务端代理，避免客户端直连被拦。 */
  api.get("/api/github/avatar/:login", async (c) => {
    const login = normalizeGithubUsername(c.req.param("login"));
    if (!isValidGithubUsername(login)) return c.text("bad request", 400);

    const res = await fetch(`https://github.com/${encodeURIComponent(login)}.png?size=160`, {
      headers: { accept: "image/*", "user-agent": "paffbot" },
      redirect: "follow",
    });
    if (!res.ok) return c.text("not found", 404);

    return new Response(res.body, {
      headers: {
        "content-type": (() => {
          const type = res.headers.get("content-type") ?? "";
          return type.startsWith("image/") ? type : "image/png";
        })(),
        "cache-control": "public, max-age=86400",
      },
    });
  });

  /** 群头像：从 Telegram 取，浏览器侧不接触 bot token。 */
  api.get("/api/group/photo/:chatId", async (c) => {
    const ctx = c.get("ctx");
    const chatId = Number.parseInt(c.req.param("chatId"), 10);
    if (!Number.isSafeInteger(chatId)) return c.text("bad request", 400);

    let { fileId, updatedAt } = await getGroupPhoto(ctx.db, chatId);
    if (!fileId || Date.now() - updatedAt > 6 * 3600 * 1000) {
      const chat = await ctx.tg.safe<TgChat>("getChat", { chat_id: chatId });
      const big = chat?.photo?.big_file_id;
      if (big) {
        await setGroupPhoto(ctx.db, chatId, big);
        fileId = big;
      }
    }
    if (!fileId) return c.text("not found", 404);

    const file = await ctx.tg.safe<TgFile>("getFile", { file_id: fileId });
    if (!file?.file_path) return c.text("not found", 404);

    const res = await ctx.tg.downloadFile(file.file_path);
    if (!res.ok) return c.text("not found", 404);

    return new Response(res.body, {
      headers: {
        "content-type": (() => {
          const type = res.headers.get("content-type") ?? "";
          return type.startsWith("image/") ? type : "image/jpeg";
        })(),
        "cache-control": "public, max-age=3600",
      },
    });
  });

  // ------------------------------------------------ GitHub OAuth（仅 Mini App）

  /** 发起授权：返回 GitHub 授权地址 + 一次性 state。 */
  api.get("/api/oauth/github/start", async (c) => {
    const ctx = c.get("ctx");
    if (!oauthEnabled(ctx.config)) return c.json({ ok: false, error: "OAuth 未配置" }, 503);

    const auth = await readInitUser(c);
    if (!auth.user) return c.json({ ok: false, error: `没拿到 Telegram 的登录信息（${auth.reason}），请从 Telegram 里打开` }, 401);

    const verificationId = c.req.query("verificationId") || null;
    const state = randomToken(24);
    await createOAuthState(ctx.db, state, auth.user.id, verificationId, 10 * 60 * 1000);

    const redirectUri = ctx.config.oauthRedirect ?? `${new URL(c.req.url).origin}/api/oauth/github/callback`;
    return c.json({ ok: true, state, url: authorizeUrl(ctx.config, state, redirectUri) });
  });

  /** GitHub 回调：换 token、取账号、建立绑定，顺带完成待验证申请。 */
  api.get("/api/oauth/github/callback", async (c) => {
    const ctx = c.get("ctx");
    const code = c.req.query("code");
    const state = c.req.query("state");
    if (!code || !state) return c.html(callbackPage("参数缺失", "GitHub 没有带回 code/state。"), 400);

    const row = await consumeOAuthState(ctx.db, state);
    if (!row) return c.html(callbackPage("链接已失效", "这次授权已过期或已被使用，请回到 Mini App 重新发起。"), 400);

    const redirectUri = ctx.config.oauthRedirect ?? `${new URL(c.req.url).origin}/api/oauth/github/callback`;
    const token = await exchangeCode(ctx.config, code, redirectUri);
    if (!token) return c.html(callbackPage("授权失败", "GitHub 没有返回 access token，请重试。"), 400);

    const account = await fetchGithubAccount(token);
    if (!account) return c.html(callbackPage("读取账号失败", "GitHub 账号信息读取失败，请重试。"), 400);

    await upsertGithubAccount(ctx.db, row.telegram_user_id, account.login, account.id, "oauth");

    let approved = false;
    if (row.verification_id) {
      const pending = await getVerification(ctx.db, row.verification_id);
      if (pending && pending.status === "pending" && pending.user_id === row.telegram_user_id) {
        approved = await approveVerification({ db: ctx.db, tg: ctx.tg }, pending, {
          method: "github_oauth",
          actorId: row.telegram_user_id,
          actorType: "user",
          proof: { githubLogin: account.login, githubId: account.id, via: "oauth" },
        });
      }
    }

    return c.html(
      callbackPage(
        approved ? "验证通过" : "绑定完成",
        approved
          ? `已绑定 GitHub 账号 ${account.login}，并放行你入群。可以关闭这个页面回到 Telegram。`
          : `已绑定 GitHub 账号 ${account.login}。可以关闭这个页面回到 Telegram。`,
      ),
    );
  });

  /** Mini App 轮询：授权是否完成。 */
  api.get("/api/oauth/github/status", async (c) => {
    const ctx = c.get("ctx");
    const auth = await readInitUser(c);
    if (!auth.user) return c.json({ ok: false, error: `没拿到 Telegram 的登录信息（${auth.reason}），请从 Telegram 里打开` }, 401);

    const account = await getGithubAccount(ctx.db, auth.user.id);
    return c.json({
      ok: true,
      bound: account ? { login: account.github_login, githubId: account.github_id, at: account.bound_at } : null,
    });
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

  /** 验证记录：分页 + 状态筛选 + 关键字搜索。 */
  api.get("/api/audit/verifications", async (c) => {
    const ctx = c.get("ctx");
    const auth = await authorizeAudit(c, ctx);
    if ("error" in auth) return c.json({ ok: false, error: auth.error }, auth.status);

    const page = Math.max(1, Number.parseInt(c.req.query("page") ?? "1", 10) || 1);
    const pageSize = Math.min(100, Math.max(5, Number.parseInt(c.req.query("pageSize") ?? "20", 10) || 20));
    const status = c.req.query("status") || undefined;
    const query = (c.req.query("q") ?? "").trim() || undefined;

    const { rows, total } = await listVerifications(ctx.db, {
      chatId: auth.chatId ?? undefined,
      status,
      query,
      limit: pageSize,
      offset: (page - 1) * pageSize,
    });

    return c.json({
      ok: true,
      page,
      pageSize,
      total,
      rows: rows.map((row) => ({
        ...publicVerification(row),
        chatId: row.chat_id,
        chatTitle: row.chat_title ?? null,
        userId: row.user_id,
        userName: row.display_name ?? row.username,
        status: row.status,
        method: row.method,
        reason: row.reason,
        operatorId: row.operator_id,
        decidedAt: row.decided_at,
      })),
    });
  });

  /** 审计日志：分页 + 动作筛选 + 关键字搜索。 */
  api.get("/api/audit/log", async (c) => {
    const ctx = c.get("ctx");
    const auth = await authorizeAudit(c, ctx);
    if ("error" in auth) return c.json({ ok: false, error: auth.error }, auth.status);

    const page = Math.max(1, Number.parseInt(c.req.query("page") ?? "1", 10) || 1);
    const pageSize = Math.min(100, Math.max(5, Number.parseInt(c.req.query("pageSize") ?? "20", 10) || 20));
    const action = c.req.query("action") || undefined;
    const query = (c.req.query("q") ?? "").trim() || undefined;

    const { rows, total } = await listAudit(ctx.db, {
      chatId: auth.chatId ?? undefined,
      action,
      query,
      limit: pageSize,
      offset: (page - 1) * pageSize,
    });

    return c.json({ ok: true, page, pageSize, total, rows: rows.map(serializeAudit) });
  });

  api.get("/api/audit/overview", async (c) => {
    const ctx = c.get("ctx");
    const auth = await authorizeAudit(c, ctx);
    if ("error" in auth) return c.json({ ok: false, error: auth.error }, auth.status);

    const chatId = auth.chatId;
    const groups = await ctx.db
      .prepare("SELECT chat_id, title FROM groups ORDER BY updated_at DESC LIMIT 200")
      .all<{ chat_id: number; title: string | null }>();

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
      groups: (groups.results ?? []).map((g) => ({ chatId: g.chat_id, title: g.title })),
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
        chatId: row.chat_id,
        chatTitle: row.chat_title ?? null,
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
  if (!auth.user) return { error: `没拿到 Telegram 的登录信息（${auth.reason}），请从 Telegram 里打开`, status: 401 };
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
  chat_title?: string | null;
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
    chatTitle: row.chat_title ?? null,
    targetUserId: row.target_user_id,
    verificationId: row.verification_id,
    detail,
  };
}

/** OAuth 回调落在浏览器里，给一个能收尾的静态页。 */
function callbackPage(title: string, message: string): string {
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title} · 芙 Bot</title>
<style>
:root{color-scheme:light dark}
body{margin:0;min-height:100vh;display:grid;place-items:center;background:#EEECF7;color:#1B1B21;
font:16px/1.6 "PingFang SC","Microsoft YaHei",system-ui,sans-serif}
@media (prefers-color-scheme: dark){body{background:#141218;color:#E7E0EC}}
.card{background:#fff;border-radius:28px;padding:40px 36px;max-width:420px;margin:24px;text-align:center;
box-shadow:0 18px 40px rgba(0,0,0,.08)}
@media (prefers-color-scheme: dark){.card{background:#1D1B20}}
h1{font-size:26px;font-weight:500;margin:0 0 12px}
p{margin:0;color:#5A5A66}
@media (prefers-color-scheme: dark){p{color:#A9A3B3}}
button{margin-top:22px;padding:13px 28px;border:0;border-radius:999px;background:#5060B0;color:#fff;
font:500 15px/1 inherit;cursor:pointer}
button:hover{background:#41509c}
.fallback{margin-top:14px;font-size:13px;color:#8b8b96}
</style></head><body><div class="card"><h1>${title}</h1><p>${message}</p>
<button type="button" id="done">好的，我知道了</button>
<p class="fallback" id="fallback" hidden>如果没有自动关闭，直接关掉这个页面即可。</p>
</div>
<script>
document.getElementById("done").addEventListener("click", function () {
  window.close();
  // close() 被浏览器拦下时（例如在 Telegram 内置浏览器里），给一句兜底提示
  setTimeout(function () { document.getElementById("fallback").hidden = false; }, 250);
});
</script></body></html>`;
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
