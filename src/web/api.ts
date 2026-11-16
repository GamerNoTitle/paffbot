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
  extendVerificationExpiry,
  updateVerificationDetail,
  verificationStats,
  type VerificationRow,
} from "../db";
import { appendAudit, listAudit } from "../db/audit";
import { adminKeyboard } from "../bot/messages";
import { DEFAULT_LANG, t } from "../i18n";
import { escapeHtml } from "../lib/html";
import { loadConfig, type Config as BOT_CONFIG, type Env } from "../env";
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
import { SETTINGS, SETTING_MAP, readSettings, writeSettings, validateSetting } from "../config/settings";
import {
  authorizeUrl,
  exchangeCode,
  fetchGithubAccount,
  oauthEnabled,
} from "../lib/github-oauth";
import { botUsername } from "../bot/identity";
import { listBindings } from "../db";
import { ADMIN_COOKIE, readCookie, signSession, verifySession } from "../lib/session";
import { consumeAdminTicket, createAdminNonce } from "../db";
import { validateInitData, type InitDataUser } from "./initdata";

export type AppBindings = { Bindings: Env; Variables: { ctx: BotContext } };

export async function buildContext(env: Env, origin: string): Promise<BotContext> {
  const config = await loadConfig(env);
  return {
    env,
    config,
    db: env.DB,
    tg: new TelegramApi(config.botToken, config.apiBase),
    providers: createProviderRegistry(config),
    origin,
  };
}

/** 人机验证通过：延长保留时限、记审计、通知管理员放行；不放行、不解禁。 */
async function markCaptchaPassed(ctx: BotContext, verification: VerificationRow): Promise<void> {
  const detail = parseDetail(verification.detail);
  if (detail.captcha_passed) return;

  const holdMs = ctx.config.captchaHoldHours * 3_600_000;
  await updateVerificationDetail(ctx.db, verification.id, {
    captcha_passed: true,
    captcha_at: Date.now(),
    cap_solved_at: null,
  });
  await extendVerificationExpiry(ctx.db, verification.id, Date.now() + holdMs);

  await appendAudit(ctx.db, {
    actorId: verification.user_id,
    actorType: "user",
    action: "verification.captcha_passed",
    chatId: verification.chat_id,
    targetUserId: verification.user_id,
    verificationId: verification.id,
    detail: { method: "captcha", holdHours: ctx.config.captchaHoldHours },
  });

  const rawName = verification.display_name ?? verification.username ?? String(verification.user_id);
  const name = `<a href="tg://user?id=${verification.user_id}">${escapeHtml(rawName)}</a>`;
  const sent = await ctx.tg.trySendMessage({
    chat_id: verification.chat_id,
    text: t(DEFAULT_LANG, "group.notice.captcha", { name }),
    parse_mode: "HTML",
    reply_markup: adminKeyboard(verification.id, DEFAULT_LANG),
  });
  if (!sent) {
    console.error("[captcha] 群提醒发送失败", verification.chat_id, verification.id);
    return;
  }
  // 记住这条消息，管理员点了通过/拒绝后要把它改成结果
  await updateVerificationDetail(ctx.db, verification.id, { admin_message_id: sent.message_id });
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
    captchaPassed: Boolean(parseDetail(row.detail).captcha_passed),
    captchaSolved: Boolean(parseDetail(row.detail).cap_solved_at),
  };
}

async function readInitUser(c: Context<AppBindings>): Promise<{ user: InitDataUser | null; reason: string }> {
  const initData = c.req.header("x-telegram-init-data") ?? "";
  const ctx = c.get("ctx");
  if (initData) {
    const result = await validateInitData(initData, ctx.config.botToken);
    return result.ok ? { user: result.user, reason: "" } : { user: null, reason: result.reason };
  }

  // 浏览器后台：Cookie 里是 Bot 发的一次性票据换来的会话
  const raw = readCookie(c.req.header("cookie") ?? null, ADMIN_COOKIE);
  if (raw) {
    const userId = await verifySession(raw, ctx.config.sessionKey);
    if (userId !== null) return { user: { id: userId, first_name: "" } as InitDataUser, reason: "" };
  }
  return { user: null, reason: "missing" };
}

export function createApi(): Hono<AppBindings> {
  const api = new Hono<AppBindings>();

  api.use("*", async (c, next) => {
    c.set("ctx", await buildContext(c.env, new URL(c.req.url).origin));
    await next();
  });

  /** 公开信息：网页要拼 Bot 深链，不需要登录。 */
  api.get("/api/meta", async (c) => {
    const ctx = c.get("ctx");
    const username = await botUsername(ctx.tg);
    const raw = readCookie(c.req.header("cookie") ?? null, ADMIN_COOKIE);
    const userId = raw ? await verifySession(raw, ctx.config.sessionKey) : null;
    return c.json({
      ok: true,
      botUsername: username,
      admin: userId !== null && isSuperAdmin(ctx.config, userId),
    });
  });

  /** 浏览器点「通过 Telegram 验证身份」：种 nonce，等 Bot 确认。 */
  api.post("/api/admin/login/start", async (c) => {
    const ctx = c.get("ctx");
    const nonce = Array.from(crypto.getRandomValues(new Uint8Array(16)))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    await createAdminNonce(ctx.db, nonce, 10 * 60_000);
    const username = await botUsername(ctx.tg);
    return c.json({
      ok: true,
      nonce,
      url: username ? `https://t.me/${username}?start=admin_${nonce}` : null,
    });
  });

  /**
   * 轻量轮询端点：只回答「这条验证现在什么状态」。
   * 前端验证码/OAuth 的兜底轮询用它，别再用 /api/session（那边要查群、查绑定、拼方法列表）。
   */
  api.get("/api/verify/status", async (c) => {
    const auth = await readInitUser(c);
    if (!auth.user) return c.json({ ok: false, error: "unauthorized" }, 401);
    const ctx = c.get("ctx");
    const id = c.req.query("id");
    if (!id) return c.json({ ok: false, error: "missing id" }, 400);

    const row = await getVerification(ctx.db, id);
    if (!row || row.user_id !== auth.user.id) return c.json({ ok: false, error: "not found" }, 404);

    const detail = parseDetail(row.detail);
    return c.json({
      ok: true,
      status: row.status,
      captchaPassed: Boolean(detail.captcha_passed),
      captchaSolved: Boolean(detail.cap_solved_at),
      expiresAt: row.expires_at,
    });
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

  /**
   * 人机验证代理：前端 Cap 组件打这两个接口，服务端再转给 Cap 实例。
   * 用 verification id 当票据（UUID，不可猜），redeem 成功才落状态。
   */
  const casProxy = async (c: Context<AppBindings>, path: "challenge" | "redeem") => {
    const ctx = c.get("ctx");
    const base = ctx.config.capjsUrl;
    if (!ctx.config.captchaEnabled || !base) return c.json({ success: false, error: "人机验证未启用" }, 404);

    const id = c.req.param("id") ?? "";
    const verification = await getVerification(ctx.db, id);
    if (!verification || verification.status !== "pending" || verification.expires_at <= Date.now()) {
      return c.json({ success: false, error: "验证已过期，请重新申请" }, 409);
    }

    const upstream = await fetch(`${base.replace(/\/+$/, "")}/api/${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: path === "challenge" ? "{}" : await c.req.text(),
    }).catch(() => null);
    if (!upstream) return c.json({ success: false, error: "人机验证服务连接失败" }, 502);

    const payload = (await upstream.json().catch(() => null)) as Record<string, unknown> | null;
    if (!payload) return c.json({ success: false, error: "人机验证服务返回异常" }, 502);

    if (path === "redeem" && payload.success === true) {
      // 只记「算完了」，等用户点按钮再落 captcha_passed 并通知管理员
      await updateVerificationDetail(ctx.db, verification.id, { cap_solved_at: Date.now() });
    }
    return c.json(payload, upstream.status as 200);
  };

  api.post("/api/captcha/:id/challenge", (c) => casProxy(c, "challenge"));
  api.post("/api/captcha/:id/redeem", (c) => casProxy(c, "redeem"));

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

    if (result.needsReview) {
      await markCaptchaPassed(ctx, verification);
      return c.json({ ok: true, approved: false, pendingReview: true, chatTitle: verification.chat_title });
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

    // github.com/<login>.png 经常 504，优先走头像 CDN，再退回旧地址
    const sources = [
      `https://avatars.githubusercontent.com/${encodeURIComponent(login)}`,
      `https://github.com/${encodeURIComponent(login)}.png?size=160`,
    ];
    let res: Response | null = null;
    for (const url of sources) {
      try {
        const attempt = await fetch(url, { headers: { accept: "image/*", "user-agent": "paffbot" }, redirect: "follow" });
        if (attempt.ok) {
          res = attempt;
          break;
        }
      } catch {
        /* 换下一个来源 */
      }
    }
    if (!res) return c.text("not found", 404);

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

  // ------------------------------------------------------------ 审计（管理者）

  /** 验证记录：分页 + 状态筛选 + 关键字搜索。 */
  /** 配置读写：只有超管能碰，写操作进审计（只记键名，不记值）。 */
  const settingsAdmin = async (c: Context<AppBindings>) => {
    const auth = await readInitUser(c);
    if (!auth.user) return { error: "请从 Telegram 里打开", errorKey: "settings.error.openFromTelegram", status: 401 as const };
    const ctx = c.get("ctx");
    if (!isSuperAdmin(ctx.config, auth.user.id)) {
      return { error: "只有超级管理员能修改配置", errorKey: "settings.error.forbidden", status: 403 as const };
    }
    return { ctx, userId: auth.user.id };
  };

  /** 当前真正生效的值（DB 覆盖 env，再回退默认）。 */
  const effectiveSettings = (config: BOT_CONFIG): Record<string, string> => ({
    ADMIN_IDS: config.adminIds.join(","),
    MINI_APP_URL: config.miniAppUrl ?? "",
    ALLOWED_BOTS: config.allowedBotIds.join(","),
    VERIFY_TTL_SECONDS: String(config.ttlSeconds),
    VERIFY_DAILY_LIMIT: String(config.dailyAttempts),
    AUDIT_RETENTION_DAYS: String(config.retentionDays),
    SCREEN_ENABLED: config.screenEnabled ? "true" : "false",
    SCREEN_KEYWORDS: config.screenKeywords.join(","),
    GITHUB_MIN_ACCOUNT_AGE_DAYS: String(config.githubMinAccountAgeDays),
    GITHUB_REQUIRED_ORG: config.githubRequiredOrg ?? "",
    GITHUB_TOKEN: config.githubToken ?? "",
    GITHUB_OAUTH_CLIENT_ID: config.oauthClientId ?? "",
    GITHUB_OAUTH_SECRET: config.oauthSecret ?? "",
    GITHUB_OAUTH_REDIRECT: config.oauthRedirect ?? "",
    CAPTCHA_ENABLED: config.captchaEnabled ? "true" : "false",
    CAPTCHA_PROVIDER: config.captchaProvider ?? "",
    CAPTCHA_CAPJS_URL: config.capjsUrl ?? "",
    CAPTCHA_HOLD_HOURS: String(config.captchaHoldHours),
    TURNSTILE_SITE_KEY: config.turnstileSiteKey ?? "",
    TURNSTILE_SECRET: config.turnstileSecret ?? "",
  });

  api.get("/api/admin/settings", async (c) => {
    const auth = await settingsAdmin(c);
    if ("error" in auth) {
      return c.json({ ok: false, error: auth.error, errorKey: (auth as { errorKey?: string }).errorKey }, auth.status);
    }

    const stored = await readSettings(auth.ctx.env);
    const effective = effectiveSettings(auth.ctx.config);
    const fields = SETTINGS.map((spec) => {
      const raw = stored.get(spec.key) ?? "";
      const fallback = raw === "" ? String((auth.ctx.env as unknown as Record<string, unknown>)[spec.key] ?? "") : "";
      // 只读项直接给推导值，用户在页面上复制去填 GitHub App
      const value = spec.readOnly ? `${auth.ctx.origin}/api/oauth/github/callback` : raw === "" ? fallback : raw;
      return {
        key: spec.key,
        group: spec.group,
        type: spec.type,
        hintKey: spec.hintKey ?? "",
        min: spec.min ?? null,
        max: spec.max ?? null,
        options: spec.options ?? null,
        secret: Boolean(spec.secret),
        readOnly: Boolean(spec.readOnly),
        // 密钥只回报「有没有值」，不回显内容
        value: spec.secret ? "" : value,
        hasValue: value !== "",
        // 没显式配置时的实际生效值，前端用它做 placeholder
        effective: spec.secret ? "" : (effective[spec.key] ?? ""),
      };
    });
    return c.json({ ok: true, fields });
  });

  api.put("/api/admin/settings", async (c) => {
    const auth = await settingsAdmin(c);
    if ("error" in auth) {
      return c.json({ ok: false, error: auth.error, errorKey: (auth as { errorKey?: string }).errorKey }, auth.status);
    }

    const body = (await safeJson(c.req.raw)) as { values?: Record<string, unknown> };
    const input = body.values ?? {};
    const writes: Array<{ key: string; value: string }> = [];
    const changed: string[] = [];

    for (const spec of SETTINGS) {
      if (spec.readOnly) continue;
      if (!(spec.key in input)) continue;
      const raw = input[spec.key];
      const next = typeof raw === "string" ? raw.trim() : String(raw ?? "").trim();

      const checked = validateSetting(spec, next);
      if (!checked.ok) return c.json({ ok: false, error: checked.error }, 400);
      writes.push({ key: spec.key, value: checked.value });
      changed.push(spec.key);
    }

    if (changed.length === 0) {
      return c.json({ ok: false, error: "没有要保存的配置", errorKey: "settings.error.nothing" }, 400);
    }

    // 超管至少要留一个，否则没人能再进这页
    if (changed.includes("ADMIN_IDS")) {
      const next = writes.find((w) => w.key === "ADMIN_IDS")?.value ?? "";
      if (next.split(/[,\s]+/).filter(Boolean).length === 0) {
        return c.json({ ok: false, error: "至少要保留一个超级管理员", errorKey: "settings.error.needAdmin" }, 400);
      }
    }

    // 人机验证：开了就必须选一种，且对应的必填项要在
    const effective = effectiveSettings(auth.ctx.config);
    const next = (key: string) => writes.find((w) => w.key === key)?.value ?? effective[key] ?? "";
    if (next("CAPTCHA_ENABLED") === "true") {
      const provider = next("CAPTCHA_PROVIDER");
      if (!provider) {
        return c.json({ ok: false, error: "启用后必须选择一种人机验证", errorKey: "settings.error.captchaProvider" }, 400);
      }
      const missing =
        provider === "cap"
          ? next("CAPTCHA_CAPJS_URL") === ""
          : next("TURNSTILE_SITE_KEY") === "" || next("TURNSTILE_SECRET") === "";
      if (missing) {
        return c.json(
          { ok: false, error: "选了这种方式但必填项为空", errorKey: "settings.error.captchaConfig" },
          400,
        );
      }
    }

    await writeSettings(auth.ctx.env, writes, auth.userId);
    await appendAudit(auth.ctx.db, {
      actorId: auth.userId,
      actorType: "super_admin",
      action: "settings.updated",
      chatId: null,
      targetUserId: null,
      verificationId: null,
      detail: { keys: changed },
    });

    return c.json({ ok: true, updated: changed });
  });

  api.post("/api/admin/settings/reset", async (c) => {
    const auth = await settingsAdmin(c);
    if ("error" in auth) {
      return c.json({ ok: false, error: auth.error, errorKey: (auth as { errorKey?: string }).errorKey }, auth.status);
    }

    const body = (await safeJson(c.req.raw)) as { keys?: unknown };
    const keys = Array.isArray(body.keys) ? body.keys.filter((k): k is string => typeof k === "string") : [];
    const allowed = keys.filter((k) => SETTING_MAP.has(k));
    if (allowed.length === 0) return c.json({ ok: false, error: "没有要重置的配置", errorKey: "settings.error.nothing" }, 400);
    if (allowed.includes("ADMIN_IDS")) {
      return c.json({ ok: false, error: "超级管理员不能通过重置清空，请直接填写", errorKey: "settings.error.resetAdmin" }, 400);
    }

    await writeSettings(
      auth.ctx.env,
      allowed.map((key) => ({ key, value: "" })),
      auth.userId,
    );
    await appendAudit(auth.ctx.db, {
      actorId: auth.userId,
      actorType: "super_admin",
      action: "settings.reset",
      chatId: null,
      targetUserId: null,
      verificationId: null,
      detail: { keys: allowed },
    });
    return c.json({ ok: true, reset: allowed });
  });

  api.get("/api/audit/verifications", async (c) => {
    const ctx = c.get("ctx");
    const auth = await authorizeAudit(c, ctx);
    if ("error" in auth) {
      return c.json({ ok: false, error: auth.error, errorKey: (auth as { errorKey?: string }).errorKey }, auth.status);
    }

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
  /** 用户绑定：通过的人都列出来，标出是不是靠验证码过的。 */
  api.get("/api/admin/bindings", async (c) => {
    const ctx = c.get("ctx");
    const auth = await authorizeAudit(c, ctx);
    if ("error" in auth) return c.json({ ok: false, error: auth.error }, auth.status);

    const chatIdRaw = c.req.query("chatId");
    const chatId = chatIdRaw ? Number.parseInt(chatIdRaw, 10) : null;
    if (chatId !== null && !Number.isSafeInteger(chatId)) {
      return c.json({ ok: false, error: "chatId 不合法" }, 400);
    }
    // 非超管只能看自己管的群
    const scope = auth.superAdmin ? chatId : auth.chatId;

    const limit = Number.parseInt(c.req.query("limit") ?? "50", 10);
    const offset = Number.parseInt(c.req.query("offset") ?? "0", 10);
    const { rows, total } = await listBindings(ctx.db, {
      chatId: scope,
      limit: Number.isFinite(limit) ? limit : 50,
      offset: Number.isFinite(offset) ? offset : 0,
    });

    return c.json({
      ok: true,
      total,
      rows: rows.map((row) => ({
        userId: row.user_id,
        displayName: row.display_name ?? row.username ?? String(row.user_id),
        username: row.username,
        chatId: row.chat_id,
        chatTitle: row.chat_title,
        method: row.method,
        viaCaptcha: row.via_captcha === 1,
        decidedAt: row.decided_at,
        github: row.github_login
          ? { login: row.github_login, id: row.github_id, boundAt: row.bound_at }
          : null,
      })),
    });
  });

  /** 绑定列表导出：给运营拿去做对账。 */
  api.get("/api/admin/bindings.csv", async (c) => {
    const ctx = c.get("ctx");
    const auth = await authorizeAudit(c, ctx);
    if ("error" in auth) {
      return c.json({ ok: false, error: auth.error, errorKey: (auth as { errorKey?: string }).errorKey }, auth.status);
    }
    const chatIdRaw = c.req.query("chatId");
    const parsed = chatIdRaw ? Number.parseInt(chatIdRaw, 10) : null;
    const scope = auth.superAdmin ? (Number.isSafeInteger(parsed ?? NaN) ? parsed : null) : auth.chatId;

    const rows: Awaited<ReturnType<typeof listBindings>>["rows"] = [];
    const pageSize = 200;
    for (let offset = 0; offset < 10000; offset += pageSize) {
      const page = await listBindings(ctx.db, { chatId: scope, limit: pageSize, offset });
      rows.push(...page.rows);
      if (page.rows.length < pageSize || rows.length >= page.total) break;
    }

    const header = [
      "telegram_user_id",
      "display_name",
      "username",
      "chat_id",
      "chat_title",
      "method",
      "via_captcha",
      "decided_at",
      "github_login",
      "github_id",
      "github_bound_at",
    ];
    const lines = [header.join(",")];
    for (const row of rows) {
      lines.push(
        [
          row.user_id,
          row.display_name ?? "",
          row.username ?? "",
          row.chat_id,
          row.chat_title ?? "",
          row.method ?? "",
          row.via_captcha === 1 ? "true" : "false",
          row.decided_at ? new Date(row.decided_at).toISOString() : "",
          row.github_login ?? "",
          row.github_id ?? "",
          row.bound_at ? new Date(row.bound_at).toISOString() : "",
        ]
          .map(csvCell)
          .join(","),
      );
    }

    return new Response("\ufeff" + lines.join("\n"), {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="paffbot-bindings-${new Date().toISOString().slice(0, 10)}.csv"`,
        "cache-control": "no-store",
      },
    });
  });

  api.get("/api/audit/log", async (c) => {
    const ctx = c.get("ctx");
    const auth = await authorizeAudit(c, ctx);
    if ("error" in auth) {
      return c.json({ ok: false, error: auth.error, errorKey: (auth as { errorKey?: string }).errorKey }, auth.status);
    }

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
    if ("error" in auth) {
      return c.json({ ok: false, error: auth.error, errorKey: (auth as { errorKey?: string }).errorKey }, auth.status);
    }

    const chatId = auth.chatId;
    const groups = await ctx.db
      .prepare("SELECT chat_id, title FROM groups ORDER BY updated_at DESC LIMIT 200")
      .all<{ chat_id: number; title: string | null }>();

    const [stats, recent, verifications] = await Promise.all([
      verificationStats(ctx.db, chatId ?? undefined),
      listAudit(ctx.db, { chatId: chatId ?? undefined, limit: 20 }),
      listVerifications(ctx.db, { chatId: chatId ?? undefined, limit: 20 }),
    ]);

    return c.json({
      ok: true,
      chatId: chatId ?? null,
      superAdmin: auth.superAdmin,
      stats,
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

  /** 用户绑定：通过的人都列出来，标出是不是靠验证码过的。 */
  api.get("/api/admin/bindings", async (c) => {
    const ctx = c.get("ctx");
    const auth = await authorizeAudit(c, ctx);
    if ("error" in auth) return c.json({ ok: false, error: auth.error }, auth.status);

    const chatIdRaw = c.req.query("chatId");
    const chatId = chatIdRaw ? Number.parseInt(chatIdRaw, 10) : null;
    if (chatId !== null && !Number.isSafeInteger(chatId)) {
      return c.json({ ok: false, error: "chatId 不合法" }, 400);
    }
    // 非超管只能看自己管的群
    const scope = auth.superAdmin ? chatId : auth.chatId;

    const limit = Number.parseInt(c.req.query("limit") ?? "50", 10);
    const offset = Number.parseInt(c.req.query("offset") ?? "0", 10);
    const { rows, total } = await listBindings(ctx.db, {
      chatId: scope,
      limit: Number.isFinite(limit) ? limit : 50,
      offset: Number.isFinite(offset) ? offset : 0,
    });

    return c.json({
      ok: true,
      total,
      rows: rows.map((row) => ({
        userId: row.user_id,
        displayName: row.display_name ?? row.username ?? String(row.user_id),
        username: row.username,
        chatId: row.chat_id,
        chatTitle: row.chat_title,
        method: row.method,
        viaCaptcha: row.via_captcha === 1,
        decidedAt: row.decided_at,
        github: row.github_login
          ? { login: row.github_login, id: row.github_id, boundAt: row.bound_at }
          : null,
      })),
    });
  });

  api.get("/api/audit/log", async (c) => {
    const ctx = c.get("ctx");
    const auth = await authorizeAudit(c, ctx);
    if ("error" in auth) {
      return c.json({ ok: false, error: auth.error, errorKey: (auth as { errorKey?: string }).errorKey }, auth.status);
    }

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
    if ("error" in auth) {
      return c.json({ ok: false, error: auth.error, errorKey: (auth as { errorKey?: string }).errorKey }, auth.status);
    }

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
    if ("error" in auth) {
      return c.json({ ok: false, error: auth.error, errorKey: (auth as { errorKey?: string }).errorKey }, auth.status);
    }

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
