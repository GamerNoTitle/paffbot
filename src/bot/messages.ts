import type { InlineKeyboardButton, InlineKeyboardMarkup } from "../lib/telegram";
import { escapeHtml, truncate } from "../lib/html";
import { formatDuration } from "../lib/time";

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
}): string {
  const list = params.methods.map((m) => `• <b>${escapeHtml(m.label)}</b> — ${escapeHtml(m.description)}`).join("\n");
  return [
    `👋 <b>${escapeHtml(params.userName)}</b>，你申请加入「<b>${escapeHtml(params.chatTitle)}</b>」。`,
    "",
    "为防止机器人批量进群，请先完成一次验证：",
    list,
    "",
    `⏳ 有效期 ${escapeHtml(formatDuration(params.ttlSeconds))}，超时后需要重新申请。` +
      (params.remaining === undefined ? "" : `\n今天还剩 ${params.remaining} 次验证机会。`),
    "点击下方按钮打开验证页（在 Telegram 内打开）。",
  ].join("\n");
}

export function groupJoinNotice(params: {
  userId: number;
  userName: string;
  ttlSeconds: number;
  botUsername?: string | null;
}): string {
  const handle = params.botUsername ? `@${params.botUsername}` : "我";
  return [
    `👤 <a href="tg://user?id=${params.userId}">${escapeHtml(params.userName)}</a> 已进群，当前处于禁言状态。`,
    `请在 ${escapeHtml(formatDuration(params.ttlSeconds))} 内私聊 ${escapeHtml(handle)} 发送 /start 完成验证。`,
    "（Telegram 不允许机器人主动私聊没和它说过话的人，所以需要你先发一条 /start）",
  ].join("\n");
}

export function dmApproved(chatTitle: string): string {
  return `✅ 验证通过，已放行你加入「${escapeHtml(chatTitle)}」。`;
}

export function dmRejected(chatTitle: string, reason: string): string {
  return `❌ 未能通过验证：${escapeHtml(reason)}\n群：${escapeHtml(chatTitle)}`;
}

export function dmTimeout(chatTitle: string): string {
  return `⌛️ 验证超时，你在「${escapeHtml(chatTitle)}」的入群状态已被取消。需要的话可以重新申请。`;
}

export function dmRateLimited(limit: number): string {
  return "今天在这个群尝试的太多了，明天再来吧！";
}

export function dmBlocked(chatTitle: string, reason: string): string {
  return `🚫 你的入群申请被自动拦截（${escapeHtml(reason)}）。如有疑问请联系群管理员。`;
}

export function commandsHelp(isAdmin: boolean, prefix = ""): string {
  const lines = [
    "<b>命令</b>",
    "/start — 发起或继续验证",
    "/id — 查看当前会话 id",
  ];
  if (isAdmin) {
    lines.push(
      "/pass &lt;uid&gt; — 放行（也可回复对方消息）",
      "/ban &lt;uid&gt; — 封禁并移出",
      "/pending — 当前群待验证人数",
      "/audit [n] — 最近 n 条审计记录",
    );
  }
  return `${prefix}${lines.join("\n")}`;
}

export function verificationSummaryLine(params: {
  userLabel: string;
  status: string;
  method: string | null;
  createdAt: number;
}): string {
  return `#${truncate(params.userLabel, 40)} · ${params.status}${params.method ? ` · ${params.method}` : ""}`;
}
