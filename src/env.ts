/**
 * 运行时配置。
 *
 * 设计原则：所有可变行为都能用 env 覆盖，代码里只保留安全的默认值。
 * 敏感值（BOT_TOKEN / WEBHOOK_SECRET / ADMIN_TOKEN）走 `wrangler secret` 或 .dev.vars，
 * 非敏感项（方法列表、TTL、题面阈值）放在 wrangler.jsonc 的 vars 里随代码走。
 */

import { readSettings } from "./config/settings";

export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;

  BOT_TOKEN?: string;
  WEBHOOK_SECRET?: string;
  /** 配置加密用的根密钥；不填则退回用 BOT_TOKEN 派生 */
  SETTINGS_KEY?: string;
  ADMIN_IDS?: string;
  ADMIN_TOKEN?: string;

  VERIFY_TTL_SECONDS?: string;
  VERIFY_DAILY_LIMIT?: string;

  MINI_APP_URL?: string;
  TELEGRAM_API_BASE?: string;

  GITHUB_TOKEN?: string;
  GITHUB_KEYS_BASE?: string;
  GITHUB_OAUTH_CLIENT_ID?: string;
  GITHUB_OAUTH_SECRET?: string;
  GITHUB_OAUTH_REDIRECT?: string;
  GITHUB_MIN_ACCOUNT_AGE_DAYS?: string;
  GITHUB_REQUIRED_ORG?: string;

  AUDIT_RETENTION_DAYS?: string;
  SCREEN_KEYWORDS?: string;
  CAPTCHA_ENABLED?: string;
  CAPTCHA_PROVIDER?: string;
  TURNSTILE_SITE_KEY?: string;
  TURNSTILE_SECRET?: string;
  TURNSTILE_VERIFY_URL?: string;
  CAPTCHA_CAPJS_URL?: string;
  /** 旧名字，保留兼容，新部署请用 CAPTCHA_CAPJS_URL */
  CAPTCHA_URL?: string;
  CAPTCHA_HOLD_HOURS?: string;
  ALLOWED_BOTS?: string;
  ENVIRONMENT?: string;
}

export interface Config {
  botToken: string;
  webhookSecret: string;
  adminIds: number[];
  adminToken: string | null;
  ttlSeconds: number;
  dailyAttempts: number;
  miniAppUrl: string | null;
  apiBase: string;
  githubToken: string | null;
  githubKeysBase: string;
  oauthClientId: string | null;
  oauthSecret: string | null;
  oauthRedirect: string | null;
  githubMinAccountAgeDays: number;
  githubRequiredOrg: string | null;
  retentionDays: number;
  screenKeywords: string[];
  /** 人机验证（Cap.js）：开启后作为「免签名」通道，通过后仍待管理员放行 */
  captchaEnabled: boolean;
  /** 二选一：cap（自建 Cap.js）或 turnstile（Cloudflare） */
  captchaProvider: "cap" | "turnstile" | null;
  /** 自建 Cap.js 的服务地址 */
  capjsUrl: string | null;
  turnstileSiteKey: string | null;
  turnstileSecret: string | null;
  turnstileVerifyUrl: string;
  captchaHoldHours: number;
  /** 允许在群里发言的 bot（Telegram id），其余一律删消息 + 封禁 */
  allowedBotIds: number[];
  environment: string;
}

/** 二选一：显式配置优先，其次按已填的字段推断；都缺就当没开。 */
/** 只认显式配置：填了就是填了，没填就是没开，不做任何推断。 */
function resolveCaptchaProvider(provider: string): "cap" | "turnstile" | null {
  const value = provider.trim().toLowerCase();
  return value === "cap" || value === "turnstile" ? value : null;
}

const DEFAULT_SCREEN_KEYWORDS = [
  "博彩",
  "菠菜",
  "彩票",
  "代充",
  "刷单",
  "跑分",
  "洗钱",
  "空投",
  "usdt",
  "trc20",
  "约炮",
  "招嫖",
  "裸聊",
  "引流",
  "加v",
  "加薇",
  "私聊我",
  "investment",
  "airdrop",
  "crypto pump",
];

function parseIntList(raw: string | undefined): number[] {
  if (!raw) return [];
  return raw
    .split(/[,\s]+/)
    .map((v) => Number.parseInt(v.trim(), 10))
    .filter((v) => Number.isSafeInteger(v) && v !== 0);
}

function parseIntOr(raw: string | undefined, fallback: number, min: number, max: number): number {
  const parsed = Number.parseInt(raw ?? "", 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

/** 兜底：base 必须是完整 URL，配错了就退回官方地址，别让所有 Telegram 调用静默失败。 */
function safeBase(value: string, fallback: string, label: string): string {
  const trimmed = value.replace(/\/+$/, "");
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (trimmed) console.error(`[config] ${label} 不是合法地址（${trimmed}），已回退到 ${fallback}`);
  return fallback;
}

export async function loadConfig(env: Env): Promise<Config> {
  // 数据库里的配置优先，缺省回退到 Worker 的 env；读失败就当没配，不影响启动
  const stored = await readSettings(env).catch(() => new Map<string, string>());
  // 空字符串一律当作「没配」，回退到下一层；这样 DB 里清空某项就等于恢复默认
  const get = (name: keyof Env, fallback = ""): string => {
    const fromDb = stored.get(name as string);
    if (fromDb !== undefined && fromDb !== "") return fromDb;
    const fromEnv = env[name] as string | undefined;
    if (fromEnv !== undefined && fromEnv !== "") return fromEnv;
    return fallback;
  };

  const botToken = get("BOT_TOKEN").trim();
  if (!botToken) throw new Error("BOT_TOKEN 未配置");
  const webhookSecret = get("WEBHOOK_SECRET").trim();
  if (!webhookSecret) throw new Error("WEBHOOK_SECRET 未配置");
  if (webhookSecret.length < 16) throw new Error("WEBHOOK_SECRET 至少 16 个字符（它同时是 URL 路径段）");

  const keywords = (get("SCREEN_KEYWORDS") ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

  return {
    botToken,
    webhookSecret,
    // 数据库是唯一来源；Worker 上的 ADMIN_IDS 只在数据库还没写过值时用于首次初始化。
    // 页面本身禁止把超管删空，所以正常运行时 env 不再参与。
    adminIds: (() => {
      const fromDb = parseIntList(stored.get("ADMIN_IDS") ?? "");
      return fromDb.length > 0 ? fromDb : parseIntList(env.ADMIN_IDS);
    })(),
    adminToken: (get("ADMIN_TOKEN") ?? "").trim() || null,
    ttlSeconds: parseIntOr(get("VERIFY_TTL_SECONDS"), 300, 60, 24 * 3600),
    dailyAttempts: parseIntOr(get("VERIFY_DAILY_LIMIT"), 3, 1, 50),
    miniAppUrl: (get("MINI_APP_URL") ?? "").trim() || null,
    apiBase: safeBase(get("TELEGRAM_API_BASE"), "https://api.telegram.org", "TELEGRAM_API_BASE"),
    githubToken: (get("GITHUB_TOKEN") ?? "").trim() || null,
    githubKeysBase: safeBase(get("GITHUB_KEYS_BASE"), "https://github.com", "GITHUB_KEYS_BASE"),
    oauthClientId: (get("GITHUB_OAUTH_CLIENT_ID") ?? "").trim() || null,
    oauthSecret: (get("GITHUB_OAUTH_SECRET") ?? "").trim() || null,
    oauthRedirect: (get("GITHUB_OAUTH_REDIRECT") ?? "").trim() || null,
    githubMinAccountAgeDays: parseIntOr(get("GITHUB_MIN_ACCOUNT_AGE_DAYS"), 0, 0, 3650),
    githubRequiredOrg: (get("GITHUB_REQUIRED_ORG") ?? "").trim() || null,
    retentionDays: parseIntOr(get("AUDIT_RETENTION_DAYS"), 365, 1, 3650),
    screenKeywords: keywords.length > 0 ? keywords : DEFAULT_SCREEN_KEYWORDS,
    captchaEnabled: ["1", "true", "yes"].includes((get("CAPTCHA_ENABLED") ?? "").toLowerCase()),
    captchaProvider: resolveCaptchaProvider(get("CAPTCHA_PROVIDER")),
    capjsUrl: (get("CAPTCHA_CAPJS_URL") || get("CAPTCHA_URL")).trim() || null,
    turnstileSiteKey: (get("TURNSTILE_SITE_KEY") ?? "").trim() || null,
    turnstileSecret: (get("TURNSTILE_SECRET") ?? "").trim() || null,
    turnstileVerifyUrl: get("TURNSTILE_VERIFY_URL", "https://challenges.cloudflare.com/turnstile/v0/siteverify"),
    captchaHoldHours: parseIntOr(get("CAPTCHA_HOLD_HOURS"), 24, 1, 720),
    allowedBotIds: parseIntList(get("ALLOWED_BOTS")),
    environment: (get("ENVIRONMENT") ?? "production").trim(),
  };
}
