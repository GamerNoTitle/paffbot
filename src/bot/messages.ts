import type { InlineKeyboardButton, InlineKeyboardMarkup } from "../lib/telegram";
import { escapeHtml, truncate } from "../lib/html";
import { formatDuration } from "../lib/time";
import { t, type Lang, DEFAULT_LANG } from "../i18n";

export interface MethodSummary {
  id: string;
  label: string;
  description: string;
}

export function miniAppKeyboard(
  url: string,
  text = "打开 Miniapp 验证",
  chatVerifyId?: string,
): InlineKeyboardMarkup {
  const rows: InlineKeyboardButton[][] = [[{ text, web_app: { url } }]];
  if (chatVerifyId) {
    rows.push([{ text: "通过聊天验证", callback_data: `chat:${chatVerifyId}` }]);
  }
  return { inline_keyboard: rows };
}

export function dmVerificationPrompt(params: {
  userName: string;
  chatTitle: string;
  methods: MethodSummary[];
  ttlSeconds: number;
  remaining?: number;
  lang?: Lang;
}): string {
  const lang = params.lang ?? DEFAULT_LANG;
  const list = params.methods
    .map((m) => `• <b>${escapeHtml(m.label)}</b>：${escapeHtml(m.description)}`)
    .join("\n");

  const lines = [
    t(lang, "dm.prompt.head", { name: escapeHtml(params.userName), chat: escapeHtml(params.chatTitle) }),
    "",
    t(lang, "dm.prompt.why"),
    list,
    "",
    t(lang, "dm.prompt.ttl", { duration: escapeHtml(formatDuration(params.ttlSeconds)) }),
  ];
  if (params.remaining !== undefined) {
    lines.push(t(lang, "dm.prompt.remaining", { count: params.remaining }));
  }
  lines.push(t(lang, "dm.prompt.cta"));
  return lines.join("\n");
}

export function groupJoinNotice(params: {
  userId: number;
  userName: string;
  lang?: Lang;
}): string {
  const lang = params.lang ?? DEFAULT_LANG;
  return t(lang, "group.notice", { uid: params.userId, name: escapeHtml(params.userName) });
}

/** 管理员在群里直接处理：通过 / 拒绝 / 封禁。 */
export function adminKeyboard(verificationId: string, lang: Lang = DEFAULT_LANG): InlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [
        { text: t(lang, "admin.approve"), callback_data: `ap:${verificationId}` },
        { text: t(lang, "admin.reject"), callback_data: `rj:${verificationId}` },
        { text: t(lang, "admin.ban"), callback_data: `bn:${verificationId}` },
      ],
    ],
  };
}

/** 入群欢迎消息上的按钮：用户侧「开始验证」+ 管理员侧「通过/拒绝/封禁」。 */
export function groupNoticeKeyboard(
  botUsername: string | null,
  verificationId: string,
  lang: Lang = DEFAULT_LANG,
): InlineKeyboardMarkup {
  const rows: InlineKeyboardButton[][] = [];
  if (botUsername) {
    rows.push([{ text: t(lang, "group.notice.button"), url: `https://t.me/${botUsername}?start=verify` }]);
  }
  rows.push(...adminKeyboard(verificationId, lang).inline_keyboard);
  return { inline_keyboard: rows };
}

/** 入群申请（还没进群）时发给群里的管理员消息。 */
export function adminNotice(params: {
  chatTitle: string;
  userId: number;
  userName: string;
  lang?: Lang;
}): string {
  const lang = params.lang ?? DEFAULT_LANG;
  return t(lang, "admin.notice", {
    chat: escapeHtml(params.chatTitle),
    name: `<a href=\"tg://user?id=${params.userId}\">${escapeHtml(params.userName)}</a>`,
  });
}

export function dmApproved(chatTitle: string, lang: Lang = DEFAULT_LANG): string {
  return t(lang, "dm.approved", { chat: escapeHtml(chatTitle) });
}

export function dmRejected(chatTitle: string, reason: string, lang: Lang = DEFAULT_LANG): string {
  return t(lang, "dm.rejected", { reason: escapeHtml(reason), chat: escapeHtml(chatTitle) });
}

export function dmTimeout(chatTitle: string, lang: Lang = DEFAULT_LANG): string {
  return t(lang, "dm.timeout", { chat: escapeHtml(chatTitle) });
}

export function dmRateLimited(lang: Lang = DEFAULT_LANG): string {
  return t(lang, "dm.rateLimited");
}

export function dmBlocked(chatTitle: string, reason: string, lang: Lang = DEFAULT_LANG): string {
  return t(lang, "dm.blocked", { reason: escapeHtml(reason) });
}

export function commandsHelp(isAdmin: boolean, prefix = "", lang: Lang = DEFAULT_LANG): string {
  const lines = [t(lang, "cmd.header"), t(lang, "cmd.start"), t(lang, "cmd.verify"), t(lang, "cmd.id")];
  if (isAdmin) {
    lines.push(t(lang, "cmd.pass"), t(lang, "cmd.ban"), t(lang, "cmd.pending"), t(lang, "cmd.audit"));
  }
  return `${prefix}${lines.join("\n")}`;
}

/** @deprecated 保留旧的导出名，避免外部调用崩掉 */
export const verificationSummaryLine = (params: {
  userLabel: string;
  status: string;
  method: string | null;
}): string => `#${truncate(params.userLabel, 40)} · ${params.status}${params.method ? ` · ${params.method}` : ""}`;
