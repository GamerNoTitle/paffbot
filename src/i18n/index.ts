import zhCN from "./zh-CN";
import en from "./en";

export type Lang = "zh-CN" | "en";

const DICTS: Record<Lang, Record<string, string>> = { "zh-CN": zhCN, en };
export const DEFAULT_LANG: Lang = "zh-CN";

/** Telegram 的 language_code（zh-hans / en-US …）→ 我们支持的两种。 */
export function normalizeLang(code?: string | null): Lang {
  const raw = (code ?? "").toLowerCase();
  if (raw.startsWith("zh")) return "zh-CN";
  if (raw.startsWith("en")) return "en";
  return DEFAULT_LANG;
}

export function t(lang: Lang, key: string, vars?: Record<string, string | number>): string {
  const text = DICTS[lang]?.[key] ?? DICTS[DEFAULT_LANG][key] ?? key;
  if (!vars) return text;
  return text.replace(/\{(\w+)\}/g, (_, name) => String(vars[name] ?? ""));
}
