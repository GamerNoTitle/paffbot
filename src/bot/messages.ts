import type { InlineKeyboardButton, InlineKeyboardMarkup, TgEntity } from "../lib/telegram";
import { escapeHtml, truncate } from "../lib/html";
import { formatDuration } from "../lib/time";
import { t, type Lang, DEFAULT_LANG } from "../i18n";

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
  ttlSeconds: number;
  remaining?: number;
  lang?: Lang;
}): string {
  const lang = params.lang ?? DEFAULT_LANG;
  // 只说明两条通路，具体验证方式在小程序里列
  const list = [t(lang, "dm.prompt.miniapp"), t(lang, "dm.prompt.chat")].join("\n");

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

/** 申请刚进来、还没开始验证时的键盘：直接跳发放行或拒掉，不带封禁。 */
export function requestNoticeKeyboard(verificationId: string, lang: Lang = DEFAULT_LANG): InlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [
        { text: t(lang, "admin.skipApprove"), callback_data: `ap:${verificationId}` },
        { text: t(lang, "admin.directReject"), callback_data: `rj:${verificationId}` },
      ],
    ],
  };
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
  userId: number;
  userName: string;
  lang?: Lang;
}): { text: string; entities: TgEntity[] } {
  const lang = params.lang ?? DEFAULT_LANG;
  // 用 tg://user 链接而不是 text_mention 实体：客户端渲染更稳，长名字也不会串位
  const link = `<a href="tg://user?id=${params.userId}">${escapeHtml(params.userName)}</a>`;
  const text = t(lang, "admin.notice", { name: link });
  return { text, entities: [] };
}

const METHOD_KEYS: Record<string, string> = {
  github: "method.github",
  github_oauth: "method.githubOauth",
  admin_pass: "method.adminPass",
  button: "method.button",
  profile: "method.profile",
  timeout: "method.timeout",
};

/** 验证方式说人话，通过/超时文案里用。 */
export function methodLabel(method: string | null, lang: Lang = DEFAULT_LANG): string {
  const key = method ? METHOD_KEYS[method] : undefined;
  return key ? t(lang, key) : (method ?? "");
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

export function aboutText(lang: Lang = DEFAULT_LANG): string {
  return [t(lang, "about.title"), t(lang, "about.body"), t(lang, "about.repo"), t(lang, "about.usage")].join("\n\n");
}

export function commandsHelp(isAdmin: boolean, prefix = "", lang: Lang = DEFAULT_LANG): string {
  const lines = [t(lang, "cmd.header"), t(lang, "cmd.start"), t(lang, "cmd.id"), t(lang, "cmd.info"), t(lang, "cmd.help")];
  if (isAdmin) {
    lines.push(
      t(lang, "cmd.pass"),
      t(lang, "cmd.ban"),
      t(lang, "cmd.unban"),
      t(lang, "cmd.pending"),
      t(lang, "cmd.audit"),
      t(lang, "cmd.allowedBots"),
      t(lang, "cmd.addAllowedBot"),
      t(lang, "cmd.delAllowedBot"),
      t(lang, "cmd.blacklist"),
      t(lang, "cmd.addBlacklist"),
      t(lang, "cmd.delBlacklist"),
    );
    lines.push("", t(lang, "cmd.buttons"));
  }
  return `${prefix}${lines.join("\n")}`;
}

const ACTION_KEYS: Record<string, string> = {
  "verification.created": "created",
  "verification.approved": "approved",
  "verification.declined": "declined",
  "verification.timeout": "timeout",
  "verification.banned": "banned",
  "verification.blocked": "blocked",
  "verification.rate_limited": "rateLimited",
  "verification.failed": "failed",
  "verification.dm_failed": "dmFailed",
  "telegram.action_failed": "telegramFailed",
  "telegram.channel_banned": "channelBanned",
  "telegram.bot_banned": "botBanned",
  "telegram.bot_allowed": "botAllowed",
  "telegram.bot_kicked": "botKicked",
  "telegram.unbanned": "unbanned",
  "telegram.blacklisted": "blacklisted",
  "telegram.blacklist_removed": "blacklistRemoved",
};

const ACTOR_KEYS: Record<string, string> = {
  user: "user",
  system: "system",
  super_admin: "superAdmin",
  admin: "admin",
};

/** /audit 输出的一行：动作和操作者都翻成人话。 */
export function auditLine(
  ts: string,
  action: string,
  actorType: string,
  actorId: number,
  targetId: number | null,
  lang: Lang = DEFAULT_LANG,
): string {
  const actionText = ACTION_KEYS[action] ? t(lang, `action.${ACTION_KEYS[action]}`) : action;
  const actorText = ACTOR_KEYS[actorType] ? t(lang, `actor.${ACTOR_KEYS[actorType]}`) : actorType;
  return `${ts} ${escapeHtml(actionText)} ${escapeHtml(actorText)} ${actorId}${targetId ? ` → ${targetId}` : ""}`;
}

/** @deprecated 保留旧的导出名，避免外部调用崩掉 */
export const verificationSummaryLine = (params: {
  userLabel: string;
  status: string;
  method: string | null;
}): string => `#${truncate(params.userLabel, 40)} · ${params.status}${params.method ? ` · ${params.method}` : ""}`;
