/**
 * 运行时配置。
 *
 * 设计原则：所有可变行为都能用 env 覆盖，代码里只保留安全的默认值。
 * 敏感值（BOT_TOKEN / WEBHOOK_SECRET / ADMIN_TOKEN）走 `wrangler secret` 或 .dev.vars，
 * 非敏感项（方法列表、TTL、题面阈值）放在 wrangler.jsonc 的 vars 里随代码走。
 */

export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;

  BOT_TOKEN?: string;
  WEBHOOK_SECRET?: string;
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
  environment: string;
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

export function loadConfig(env: Env): Config {
  const botToken = (env.BOT_TOKEN ?? "").trim();
  if (!botToken) throw new Error("BOT_TOKEN 未配置");
  const webhookSecret = (env.WEBHOOK_SECRET ?? "").trim();
  if (!webhookSecret) throw new Error("WEBHOOK_SECRET 未配置");
  if (webhookSecret.length < 16) throw new Error("WEBHOOK_SECRET 至少 16 个字符（它同时是 URL 路径段）");

  const keywords = (env.SCREEN_KEYWORDS ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

  return {
    botToken,
    webhookSecret,
    adminIds: parseIntList(env.ADMIN_IDS),
    adminToken: (env.ADMIN_TOKEN ?? "").trim() || null,
    ttlSeconds: parseIntOr(env.VERIFY_TTL_SECONDS, 300, 60, 24 * 3600),
    dailyAttempts: parseIntOr(env.VERIFY_DAILY_LIMIT, 3, 1, 50),
    miniAppUrl: (env.MINI_APP_URL ?? "").trim() || null,
    apiBase: (env.TELEGRAM_API_BASE ?? "https://api.telegram.org").replace(/\/+$/, ""),
    githubToken: (env.GITHUB_TOKEN ?? "").trim() || null,
    githubKeysBase: (env.GITHUB_KEYS_BASE ?? "https://github.com").replace(/\/+$/, ""),
    oauthClientId: (env.GITHUB_OAUTH_CLIENT_ID ?? "").trim() || null,
    oauthSecret: (env.GITHUB_OAUTH_SECRET ?? "").trim() || null,
    oauthRedirect: (env.GITHUB_OAUTH_REDIRECT ?? "").trim() || null,
    githubMinAccountAgeDays: parseIntOr(env.GITHUB_MIN_ACCOUNT_AGE_DAYS, 0, 0, 3650),
    githubRequiredOrg: (env.GITHUB_REQUIRED_ORG ?? "").trim() || null,
    retentionDays: parseIntOr(env.AUDIT_RETENTION_DAYS, 365, 1, 3650),
    screenKeywords: keywords.length > 0 ? keywords : DEFAULT_SCREEN_KEYWORDS,
    environment: (env.ENVIRONMENT ?? "production").trim(),
  };
}
