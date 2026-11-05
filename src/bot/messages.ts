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
  const list = params.methods.map((m) => `• <b>${escapeHtml(m.label)}</b>：${escapeHtml(m.description)}`).join("\n");
  return [
    `<b>${escapeHtml(params.userName)}</b>，你申请加入「<b>${escapeHtml(params.chatTitle)}</b>」。`,
    "",
    "进群前先验证一下，防止机器人批量拉人。",
    list,
    "",
    `⏳ ${escapeHtml(formatDuration(params.ttlSeconds))} 内有效，过期就得重新申请。` +
      (params.remaining === undefined ? "" : `\n今天还能试 ${params.remaining} 次。`),
    "点下面的按钮就能开始。",
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
    `<a href="tg://user?id=${params.userId}">${escapeHtml(params.userName)}</a> 进群了，现在是禁言状态。`,
    `让 ta 在 ${escapeHtml(formatDuration(params.ttlSeconds))} 内私聊 ${escapeHtml(handle)} 发一句 /start 完成验证。`,
    "（Telegram 不让机器人主动找没说过话的人，所以要 ta 先发一句。）",
  ].join("\n");
}

export function dmApproved(chatTitle: string): string {
  return `✅ 搞定，已经放你进「${escapeHtml(chatTitle)}」了。`;
}

export function dmRejected(chatTitle: string, reason: string): string {
  return `❌ 没通过：${escapeHtml(reason)}\n群：${escapeHtml(chatTitle)}`;
}

export function dmTimeout(chatTitle: string): string {
  return `⌛️ 超时了，你在「${escapeHtml(chatTitle)}」的申请已经取消。想进的话重新申请一次。`;
}

export function dmRateLimited(limit: number): string {
  return "今天在这个群尝试的太多了，明天再来吧！";
}

export function dmBlocked(chatTitle: string, reason: string): string {
  return `🚫 你的申请被自动拦下了（${escapeHtml(reason)}）。有疑问找群管理员。`;
}

export function commandsHelp(isAdmin: boolean, prefix = ""): string {
  const lines = [
    "<b>命令</b>",
    "/start：开始或继续验证",
    "/id：看自己的 id",
  ];
  if (isAdmin) {
    lines.push(
      "/pass &lt;uid&gt;：放人进来（也可以回复对方消息）",
      "/ban &lt;uid&gt;：封了并踢出去",
      "/pending：还有几个人在等验证",
      "/audit [n]：最近 n 条操作记录",
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
