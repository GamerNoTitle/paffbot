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
  /** 说明文案的 i18n key，文案放在 public/i18n 里 */
  hintKey?: string;
}

export const SETTINGS: readonly SettingSpec[] = [
  { key: "ADMIN_IDS", group: "basic", type: "intList", hintKey: "settings.hint.ADMIN_IDS" },
  { key: "MINI_APP_URL", group: "basic", type: "url", hintKey: "settings.hint.MINI_APP_URL" },
  { key: "VERIFY_TTL_SECONDS", group: "verify", type: "int", min: 60, max: 86400, hintKey: "settings.hint.VERIFY_TTL_SECONDS" },
  { key: "VERIFY_DAILY_LIMIT", group: "verify", type: "int", min: 1, max: 50, hintKey: "settings.hint.VERIFY_DAILY_LIMIT" },
  { key: "AUDIT_RETENTION_DAYS", group: "verify", type: "int", min: 1, max: 3650, hintKey: "settings.hint.AUDIT_RETENTION_DAYS" },
  { key: "SCREEN_KEYWORDS", group: "verify", type: "csv", hintKey: "settings.hint.SCREEN_KEYWORDS" },
  { key: "ALLOWED_BOTS", group: "basic", type: "intList", hintKey: "settings.hint.ALLOWED_BOTS" },
  { key: "GITHUB_MIN_ACCOUNT_AGE_DAYS", group: "github", type: "int", min: 0, max: 3650, hintKey: "settings.hint.GITHUB_MIN_ACCOUNT_AGE_DAYS" },
  { key: "GITHUB_REQUIRED_ORG", group: "github", type: "string", hintKey: "settings.hint.GITHUB_REQUIRED_ORG" },
  { key: "GITHUB_TOKEN", group: "github", type: "string", secret: true, hintKey: "settings.hint.GITHUB_TOKEN" },
  { key: "GITHUB_OAUTH_CLIENT_ID", group: "github", type: "string", hintKey: "settings.hint.GITHUB_OAUTH_CLIENT_ID" },
  { key: "GITHUB_OAUTH_SECRET", group: "github", type: "string", secret: true, hintKey: "settings.hint.GITHUB_OAUTH_SECRET" },
  { key: "GITHUB_OAUTH_REDIRECT", group: "github", type: "url", hintKey: "settings.hint.GITHUB_OAUTH_REDIRECT" },
  { key: "CAPTCHA_ENABLED", group: "captcha", type: "bool", hintKey: "settings.hint.CAPTCHA_ENABLED" },
  { key: "CAPTCHA_PROVIDER", group: "captcha", type: "enum", options: ["cap", "turnstile"], hintKey: "settings.hint.CAPTCHA_PROVIDER" },
  { key: "CAPTCHA_URL", group: "captcha", type: "url", hintKey: "settings.hint.CAPTCHA_URL" },
  { key: "CAPTCHA_HOLD_HOURS", group: "captcha", type: "int", min: 1, max: 720, hintKey: "settings.hint.CAPTCHA_HOLD_HOURS" },
  { key: "TURNSTILE_SITE_KEY", group: "captcha", type: "string", hintKey: "settings.hint.TURNSTILE_SITE_KEY" },
  { key: "TURNSTILE_SECRET", group: "captcha", type: "string", secret: true, hintKey: "settings.hint.TURNSTILE_SECRET" },
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
