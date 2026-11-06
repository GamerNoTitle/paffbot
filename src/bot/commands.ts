import {
  countPending,
  createVerification,
  findLatestPendingForUser,
  findOpenVerificationForChat,
  getVerification,
  listVerifications,
  type VerificationRow,
} from "../db";
import { appendAudit, listAudit } from "../db/audit";
import { randomToken } from "../lib/crypto";
import { displayName, escapeHtml, truncate } from "../lib/html";
import type { InlineKeyboardMarkup, TgMessage } from "../lib/telegram";
import { formatDateTime } from "../lib/time";
import { approveVerification, rejectVerification } from "../verify/finalize";
import { isGroupAdmin, isSuperAdmin } from "./auth";
import { miniAppUrl, type BotContext } from "./context";
import { botUsername } from "./identity";
import { aboutText, auditLine, commandsHelp, miniAppKeyboard } from "./messages";
import { sendVerificationPrompt } from "./prompt";
import { normalizeLang, type Lang } from "../i18n";

const COMMAND_RE = /^\/([a-zA-Z0-9_]+)(?:@[A-Za-z0-9_]+)?(?:\s+([\s\S]*))?$/;

interface CommandEnv {
  lang: Lang;
  ctx: BotContext;
  chatId: number;
  isPrivate: boolean;
  userId: number;
  message: TgMessage;
  args: string[];
  superAdmin: boolean;
}

async function reply(env: CommandEnv, text: string, keyboard?: InlineKeyboardMarkup): Promise<void> {
  await env.ctx.tg.trySendMessage({
    chat_id: env.chatId,
    text,
    parse_mode: "HTML",
    ...(keyboard ? { reply_markup: keyboard } : {}),
  });
}

function targetUserId(env: CommandEnv): number | null {
  const replied = env.message.reply_to_message?.from;
  if (replied && !replied.is_bot) return replied.id;
  const raw = env.args[0];
  if (!raw) return null;
  const parsed = Number.parseInt(raw.replace(/^@/, ""), 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

async function requireAdmin(env: CommandEnv): Promise<{ actorType: "super_admin" | "group_admin" } | null> {
  if (env.isPrivate) return null;
  if (env.superAdmin) return { actorType: "super_admin" };
  if (env.isPrivate) return null;
  const admin = await isGroupAdmin(env.ctx, env.chatId, env.userId);
  return admin ? { actorType: "group_admin" } : null;
}

export async function handleCommand(ctx: BotContext, message: TgMessage, _updateId: number): Promise<void> {
  const from = message.from;
  if (!from || from.is_bot || !message.text) return;

  const match = COMMAND_RE.exec(message.text.trim());
  if (!match) return;

  const command = (match[1] ?? "").toLowerCase();
  const argsText = (match[2] ?? "").trim();
  const chat = message.chat;
  const isPrivate = chat.type === "private";
  if (!isPrivate && chat.type !== "group" && chat.type !== "supergroup") return;

  const lang = normalizeLang(from.language_code);
  const env: CommandEnv = {
    lang,
    ctx,
    chatId: chat.id,
    isPrivate,
    userId: from.id,
    message,
    args: argsText ? argsText.split(/\s+/) : [],
    superAdmin: isSuperAdmin(ctx.config, from.id),
  };

  switch (command) {
    case "start":
      await handleStart(env);
      return;
    case "info":
    case "about":
      await reply(env, aboutText(env.lang));
      return;
    case "help":
      await reply(env, commandsHelp(env.superAdmin && !env.isPrivate, "", env.lang));
      return;
    case "id":
      await reply(
        env,
        `会话 id：<code>${chat.id}</code>\n你的 id：<code>${from.id}</code>\n类型：${escapeHtml(chat.type)}`,
      );
      return;
    case "pass":
      await handlePass(env);
      return;
    case "ban":
      await handleBan(env);
      return;
    case "pending":
      await handlePending(env);
      return;
    case "audit":
      await handleAudit(env);
      return;
    case "selftest":
      await handleSelfTest(env);
      return;
    default:
      if (isPrivate) await reply(env, "未知命令，发送 /help 查看可用命令。");
  }
}

async function handleStart(env: CommandEnv): Promise<void> {
  if (!env.isPrivate) {
    const username = await botUsername(env.ctx.tg);
    await reply(
      env,
      "验证需要在<strong>私聊</strong>里完成（Telegram 只允许在私聊里放 Mini App 按钮）。\n" +
        "点下面的按钮直接打开私聊；也可以发 /id 查看群 id 和你自己的 id。",
      username ? { inline_keyboard: [[{ text: "私聊我完成验证", url: `https://t.me/${username}?start=verify` }]] } : undefined,
    );
    return;
  }

  const wantsChat = env.args[0]?.toLowerCase() === "chat";
  const pending = await findLatestPendingForUser(env.ctx.db, env.userId);

  if (pending) {
    if (wantsChat) {
      await reply(
        env,
        `你还有一条待完成的验证：<b>${escapeHtml(pending.chat_title ?? String(pending.chat_id))}</b>\n` +
          "发 <code>/verify 你的GitHub用户名</code>，我用聊天把签名流程走完。",
      );
      return;
    }

    const url = `${miniAppUrl(env.ctx)}/?chat=${pending.chat_id}`;
    await reply(
      env,
      `你还有一条待完成的验证：<b>${escapeHtml(pending.chat_title ?? String(pending.chat_id))}</b>\n` +
        "点按钮用 Mini App 完成，或发 /verify 用户名 走聊天验证。",
      miniAppKeyboard(url, "继续验证"),
    );
    return;
  }

  await reply(
    env,
    commandsHelp(
      env.superAdmin && !env.isPrivate,
      `你好，我是群验证机器人。\n你的 Telegram ID：<code>${env.userId}</code>\n\n`,
      env.lang,
    ),
  );

  // 管理员额外给一个审计入口（普通用户看不到这个标签页）
  if (env.superAdmin) {
    await reply(env, "你是超级管理员，可以在网页端查看审计。", {
      inline_keyboard: [[{ text: "打开审计面板", web_app: { url: `${miniAppUrl(env.ctx)}/admin` } }]],
    });
  }
}

async function handlePass(env: CommandEnv): Promise<void> {
  const auth = await requireAdmin(env);
  if (!auth) {
    await reply(env, "请在目标群里使用该命令（需要 can_restrict_members 权限）。");
    return;
  }
  const target = targetUserId(env);
  if (!target) {
    await reply(env, "用法：/pass <用户id>，或回复对方的消息。");
    return;
  }

  const pending = await findOpenVerificationForChat(env.ctx.db, env.chatId, target);
  if (pending) {
    await approveVerification({ db: env.ctx.db, tg: env.ctx.tg }, pending, {
      method: "admin_pass",
      actorId: env.userId,
      actorType: auth.actorType,
    });
    await reply(env, `已放行 <code>${target}</code>（记录 ${pending.id.slice(0, 8)}）。`);
    return;
  }

  // 没有 DB 记录（例如 bot 刚上线、或历史申请）：直接打 Telegram 接口，但仍然落审计
  try {
    await env.ctx.tg.approveChatJoinRequest(env.chatId, target);
  } catch {
    await env.ctx.tg.unrestrictChatMember(env.chatId, target).catch(() => undefined);
  }
  await appendAudit(env.ctx.db, {
    actorId: env.userId,
    actorType: auth.actorType,
    action: "verification.approved",
    chatId: env.chatId,
    targetUserId: target,
    verificationId: null,
    detail: { method: "admin_pass", note: "no pending row" },
  });
  await reply(env, `已手动放行 <code>${target}</code>（无待验证记录，已直接调用 Telegram）。`);
}

async function handleBan(env: CommandEnv): Promise<void> {
  const auth = await requireAdmin(env);
  if (!auth) {
    await reply(env, "请在目标群里使用该命令（需要 can_restrict_members 权限）。");
    return;
  }
  const target = targetUserId(env);
  if (!target) {
    await reply(env, "用法：/ban <用户id>，或回复对方的消息。");
    return;
  }

  const pending = await findOpenVerificationForChat(env.ctx.db, env.chatId, target);
  if (pending) {
    await rejectVerification({ db: env.ctx.db, tg: env.ctx.tg }, pending, {
      status: "banned",
      method: "admin_ban",
      reason: "admin_ban",
      actorId: env.userId,
      actorType: auth.actorType,
    });
    await reply(env, `已封禁 <code>${target}</code>。`);
    return;
  }

  await env.ctx.tg.banChatMember(env.chatId, target).catch(() => undefined);
  await appendAudit(env.ctx.db, {
    actorId: env.userId,
    actorType: auth.actorType,
    action: "verification.banned",
    chatId: env.chatId,
    targetUserId: target,
    verificationId: null,
    detail: { method: "admin_ban", note: "no pending row" },
  });
  await reply(env, `已封禁 <code>${target}</code>。`);
}

async function handlePending(env: CommandEnv): Promise<void> {
  const auth = await requireAdmin(env);
  if (!auth) {
    await reply(env, "请在目标群里使用该命令（需要 can_restrict_members 权限）。");
    return;
  }
  const [count, list] = await Promise.all([
    countPending(env.ctx.db, env.chatId),
    listVerifications(env.ctx.db, { chatId: env.chatId, status: "pending", limit: 10 }),
  ]);
  if (count === 0) {
    await reply(env, "当前没有待验证的申请。");
    return;
  }
  const lines = list.rows.map(
    (row) =>
      `• <code>${row.user_id}</code> ${escapeHtml(truncate(row.display_name ?? row.username ?? "未知", 24))} · ${formatDateTime(row.created_at)}`,
  );
  await reply(env, `<b>待验证 ${count} 人</b>（最近 ${list.rows.length} 条）\n${lines.join("\n")}`);
}

async function handleAudit(env: CommandEnv): Promise<void> {
  const auth = await requireAdmin(env);
  if (!auth) {
    await reply(env, "请在目标群里使用该命令（需要 can_restrict_members 权限）。");
    return;
  }
  const requested = Number.parseInt(env.args[0] ?? "10", 10);
  const limit = Number.isFinite(requested) ? Math.min(50, Math.max(1, requested)) : 10;
  const { rows } = await listAudit(env.ctx.db, { chatId: env.chatId, limit });
  if (rows.length === 0) {
    await reply(env, "还没有审计记录。");
    return;
  }
  const lines = rows.map((row) =>
    auditLine(formatDateTime(row.ts), row.action, row.actor_type, row.actor_id, row.target_user_id, env.lang),
  );
  await reply(env, `<b>最近 ${rows.length} 条审计</b>\n${lines.join("\n")}\n\n完整查询见 Mini App 的审计页。`);
}

/**
 * 超管自测：生成一条真实的 pending 记录并把 Mini App 按钮私聊发给自己。
 * 这样不用小号也能把「填用户名 → 签名 → 验签 → 放行」整条链路走一遍。
 * 来源记为 admin，放行时不会改动群成员。
 */
async function handleSelfTest(env: CommandEnv): Promise<void> {
  if (!env.superAdmin) {
    await reply(env, "只有超管可以自测。");
    return;
  }

  let chatId = env.chatId;
  let chatTitle = env.message.chat.title ?? String(chatId);

  if (env.isPrivate) {
    const parsed = Number.parseInt(env.args[0] ?? "", 10);
    if (!Number.isSafeInteger(parsed)) {
      await reply(env, "私聊里用需要指定群 id：<code>/selftest -1001234567890</code>\n更推荐直接在目标群里发 /selftest。");
      return;
    }
    chatId = parsed;
    chatTitle = String(parsed);
    try {
      const chat = await env.ctx.tg.call<{ title?: string }>("getChat", { chat_id: chatId });
      chatTitle = chat.title ?? chatTitle;
    } catch {
      // 标题拿不到不影响自测
    }
  }

  const id = crypto.randomUUID();
  const createdAt = Date.now();
  await createVerification(env.ctx.db, {
    id,
    chatId,
    chatTitle,
    userId: env.userId,
    username: env.message.from?.username ?? null,
    displayName: displayName(env.message.from ?? { id: env.userId, first_name: "admin" }),
    status: "pending",
    source: "admin",
    updateId: null,
    nonce: randomToken(16),
    createdAt,
    // 自测没有 Telegram 的 5 分钟私聊窗口限制，给足时间跑签名命令
    expiresAt: createdAt + 30 * 60 * 1000,
    detail: { selftest: true },
  });

  const row = await getVerification(env.ctx.db, id);
  if (!row) {
    await reply(env, "创建自测记录失败，请稍后再试。");
    return;
  }

  await appendAudit(env.ctx.db, {
    actorId: env.userId,
    actorType: "super_admin",
    action: "verification.created",
    chatId,
    targetUserId: env.userId,
    verificationId: id,
    detail: { source: "admin", selftest: true },
  });

  const sent = env.message.from ? await sendVerificationPrompt(env.ctx, row, env.message.from) : false;
  await reply(
    env,
    sent
      ? "已私聊发送验证入口（自测记录，放行不会真的改动群成员）。"
      : "私聊发送失败：请先给 bot 发过一条消息，或检查是否屏蔽了 bot。",
  );
}
