import { decryptValue, encryptValue } from "./crypto";

/** 允许进数据库的配置项。没列在这里的 env 不会被网页覆盖。 */
export type SettingType = "int" | "intList" | "string" | "url" | "bool" | "enum" | "csv";

export interface SettingSpec {
  key: string;
  group: "basic" | "verify" | "github" | "captcha";
  type: SettingType;
  secret?: boolean;
  min?: number;
  max?: number;
  options?: readonly string[];
  /** 界面上的一句话说明 */
  hint?: string;
}

export const SETTINGS: readonly SettingSpec[] = [
  { key: "ADMIN_IDS", group: "basic", type: "intList", hint: "超级管理员 Telegram id，至少保留一个（Worker 上的 ADMIN_IDS 仍然有效，用作救急）" },
  { key: "MINI_APP_URL", group: "basic", type: "url", hint: "留空则按请求来源自动推导" },
  { key: "VERIFY_TTL_SECONDS", group: "verify", type: "int", min: 60, max: 86400, hint: "验证有效期，秒；申请模式不要超过 300" },
  { key: "VERIFY_DAILY_LIMIT", group: "verify", type: "int", min: 1, max: 50, hint: "每个账号在每个群每天的次数" },
  { key: "AUDIT_RETENTION_DAYS", group: "verify", type: "int", min: 1, max: 3650, hint: "审计记录保留天数" },
  { key: "SCREEN_KEYWORDS", group: "verify", type: "csv", hint: "广告关键词，逗号分隔；留空用内置词表" },
  { key: "ALLOWED_BOTS", group: "basic", type: "intList", hint: "全局放行的 bot id，其余 bot 发言会被删除并封禁" },
  { key: "GITHUB_MIN_ACCOUNT_AGE_DAYS", group: "github", type: "int", min: 0, max: 3650, hint: "GitHub 账号最少注册天数，0 表示不限制" },
  { key: "GITHUB_REQUIRED_ORG", group: "github", type: "string", hint: "要求加入的 GitHub 组织，留空不限制" },
  { key: "GITHUB_TOKEN", group: "github", type: "string", secret: true, hint: "查询账号年龄/组织时用，可留空" },
  { key: "GITHUB_OAUTH_CLIENT_ID", group: "github", type: "string", hint: "GitHub OAuth App 的 client id" },
  { key: "GITHUB_OAUTH_SECRET", group: "github", type: "string", secret: true, hint: "GitHub OAuth App 的 client secret" },
  { key: "GITHUB_OAUTH_REDIRECT", group: "github", type: "url", hint: "留空按请求来源推导" },
  { key: "CAPTCHA_ENABLED", group: "captcha", type: "bool", hint: "开启后小程序里多一个「人机验证」通道" },
  { key: "CAPTCHA_PROVIDER", group: "captcha", type: "enum", options: ["", "cap", "turnstile"], hint: "二选一，留空按已填字段推断" },
  { key: "CAPTCHA_URL", group: "captcha", type: "url", hint: "自建 Cap.js 的地址" },
  { key: "CAPTCHA_HOLD_HOURS", group: "captcha", type: "int", min: 1, max: 720, hint: "人机验证通过后保留的时长，小时" },
  { key: "TURNSTILE_SITE_KEY", group: "captcha", type: "string", hint: "Cloudflare Turnstile 的 site key" },
  { key: "TURNSTILE_SECRET", group: "captcha", type: "string", secret: true, hint: "Cloudflare Turnstile 的 secret" },
];

export const SETTING_MAP = new Map(SETTINGS.map((s) => [s.key, s]));

export interface StoredSetting {
  value: string;
  encrypted: boolean;
  updatedAt: number;
  updatedBy: number | null;
}

/** 解密后的配置快照；进程内缓存 30 秒，写入后立刻失效。 */
let cache: { at: number; data: Map<string, string> } | null = null;
const CACHE_MS = 30_000;

function material(env: { SETTINGS_KEY?: string; BOT_TOKEN?: string }): string {
  return (env.SETTINGS_KEY ?? "").trim() || (env.BOT_TOKEN ?? "").trim();
}

export function invalidateSettingsCache(): void {
  cache = null;
}

export async function readSettings(env: {
  DB: D1Database;
  SETTINGS_KEY?: string;
  BOT_TOKEN?: string;
}): Promise<Map<string, string>> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.data;

  const { results } = await env.DB.prepare("SELECT key, value, encrypted FROM settings").all<{
    key: string;
    value: string | null;
    encrypted: number;
  }>();

  const key = material(env);
  const data = new Map<string, string>();
  for (const row of results ?? []) {
    const raw = row.value ?? "";
    if (!row.encrypted) {
      data.set(row.key, raw);
      continue;
    }
    const plain = await decryptValue(raw, key);
    if (plain !== null) data.set(row.key, plain);
  }

  cache = { at: Date.now(), data };
  return data;
}

export interface SettingWrite {
  key: string;
  value: string;
}

/** 写库：secret 类字段加密后存，空值表示删除该项（回退到 env / 默认值）。 */
export async function writeSettings(
  env: { DB: D1Database; SETTINGS_KEY?: string; BOT_TOKEN?: string },
  writes: SettingWrite[],
  actorId: number | null,
): Promise<void> {
  const key = material(env);
  const now = Date.now();

  for (const { key: name, value } of writes) {
    const spec = SETTING_MAP.get(name);
    if (!spec) continue;

    if (value === "") {
      await env.DB.prepare("DELETE FROM settings WHERE key = ?").bind(name).run();
      continue;
    }

    if (spec.secret) {
      const encrypted = await encryptValue(value, key);
      await env.DB.prepare(
        "INSERT INTO settings (key, value, encrypted, updated_at, updated_by) VALUES (?, ?, 1, ?, ?) " +
          "ON CONFLICT(key) DO UPDATE SET value = excluded.value, encrypted = 1, updated_at = excluded.updated_at, updated_by = excluded.updated_by",
      )
        .bind(name, encrypted, now, actorId)
        .run();
      continue;
    }

    await env.DB.prepare(
      "INSERT INTO settings (key, value, encrypted, updated_at, updated_by) VALUES (?, ?, 0, ?, ?) " +
        "ON CONFLICT(key) DO UPDATE SET value = excluded.value, encrypted = 0, updated_at = excluded.updated_at, updated_by = excluded.updated_by",
    )
      .bind(name, value, now, actorId)
      .run();
  }

  invalidateSettingsCache();
}

export type ValidateResult = { ok: true; value: string } | { ok: false; error: string };

/** 统一校验入口：前端提示与后端拒绝用的是同一套规则。 */
export function validateSetting(spec: SettingSpec, raw: string): ValidateResult {
  const value = raw.trim();

  if (value === "") return { ok: true, value: "" };

  switch (spec.type) {
    case "int": {
      if (!/^\d+$/.test(value)) return { ok: false, error: `${spec.key} 必须是整数` };
      const n = Number.parseInt(value, 10);
      if (spec.min !== undefined && n < spec.min) return { ok: false, error: `${spec.key} 不能小于 ${spec.min}` };
      if (spec.max !== undefined && n > spec.max) return { ok: false, error: `${spec.key} 不能大于 ${spec.max}` };
      return { ok: true, value: String(n) };
    }
    case "intList": {
      const ids = value
        .split(/[,\s]+/)
        .filter(Boolean)
        .map((v) => v.trim());
      if (!ids.every((v) => /^\d+$/.test(v))) return { ok: false, error: `${spec.key} 只能填数字 id，逗号分隔` };
      return { ok: true, value: ids.join(",") };
    }
    case "bool":
      if (!["true", "false", "1", "0"].includes(value.toLowerCase())) {
        return { ok: false, error: `${spec.key} 只能是 true 或 false` };
      }
      return { ok: true, value: ["true", "1"].includes(value.toLowerCase()) ? "true" : "false" };
    case "enum":
      if (spec.options && !spec.options.includes(value)) {
        return { ok: false, error: `${spec.key} 只能取 ${spec.options.filter(Boolean).join(" / ")}` };
      }
      return { ok: true, value };
    case "url":
      if (!/^https?:\/\//i.test(value)) return { ok: false, error: `${spec.key} 需要以 http:// 或 https:// 开头` };
      return { ok: true, value };
    default:
      return { ok: true, value };
  }
}
