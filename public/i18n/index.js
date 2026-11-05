import zhCN from "./zh-CN.js";
import en from "./en.js";

const DICTS = { "zh-CN": zhCN, en };
const FALLBACK = "zh-CN";

let active = FALLBACK;

/** 粗略的浏览器/Telegram 语言 → 我们支持的 locale。 */
export function detectLang(telegramLang) {
  const saved = localStorage.getItem("paffbot.lang");
  if (saved && DICTS[saved]) return saved;

  const raw = (telegramLang || navigator.language || FALLBACK).toLowerCase();
  if (raw.startsWith("zh")) return "zh-CN";
  if (raw.startsWith("en")) return "en";
  return FALLBACK;
}

export function setLang(lang) {
  active = DICTS[lang] ? lang : FALLBACK;
  localStorage.setItem("paffbot.lang", active);
  document.documentElement.lang = active;
  return active;
}

export function getLang() {
  return active;
}

/** t("hero.greeting", { name: "Paff" }) */
export function t(key, vars) {
  const table = DICTS[active] ?? DICTS[FALLBACK];
  const text = table[key] ?? DICTS[FALLBACK][key] ?? key;
  if (!vars) return text;
  return text.replace(/\{(\w+)\}/g, (_, name) => (vars[name] ?? ""));
}

/** 把 data-i18n / data-i18n-attr 里声明的静态文案刷一遍。 */
export function applyStaticI18n(root = document) {
  for (const el of root.querySelectorAll("[data-i18n]")) {
    el.textContent = t(el.dataset.i18n);
  }
  for (const el of root.querySelectorAll("[data-i18n-label]")) {
    el.setAttribute("label", t(el.dataset.i18nLabel));
  }
  for (const el of root.querySelectorAll("[data-i18n-aria]")) {
    el.setAttribute("aria-label", t(el.dataset.i18nAria));
  }
  for (const el of root.querySelectorAll("[data-i18n-alt]")) {
    el.setAttribute("alt", t(el.dataset.i18nAlt));
  }
}

export const LANGUAGES = [
  ["zh-CN", "中文"],
  ["en", "English"],
];
