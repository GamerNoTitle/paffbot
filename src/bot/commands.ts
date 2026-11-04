import {
  countPending,
  createVerification,
  deleteSshKey,
  findOpenVerificationForChat,
  getVerification,
  listSshKeys,
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
import { commandsHelp, miniAppKeyboard } from "./messages";
import { sendVerificationPrompt } from "./prompt";

const COMMAND_RE = /^\/([a-zA-Z0-9_]+)(?:@[A-Za-z0-9_]+)?(?:\s+([\s\S]*))?$/;

interface CommandEnv {
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

  const env: CommandEnv = {
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
    case "help":
      await reply(env, commandsHelp(env.superAdmin));
      return;
    case "id":
      await reply(
        env,
        `会话 id：<code>${chat.id}</code>\n你的 id：<code>${from.id}</code>\n类型：${escapeHtml(chat.type)}`,
      );
      return;
    case "keys":
      await handleKeys(env);
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
    case "unlink":
      await handleUnlink(env);
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

  const pending = await env.ctx.db
    .prepare(
      `SELECT * FROM verifications WHERE user_id = ? AND status = 'pending' AND expires_at > ? ORDER BY created_at DESC LIMIT 1`,
    )
    .bind(env.userId, Date.now())
    .first<VerificationRow>();

  if (pending) {
    const url = `${miniAppUrl(env.ctx)}/?chat=${pending.chat_id}`;
    await reply(
      env,
      `你还有一条待完成的验证：<b>${escapeHtml(pending.chat_title ?? String(pending.chat_id))}</b>\n点下面的按钮继续。`,
      miniAppKeyboard(url, "🛡 继续验证"),
    );
    return;
  }

  await reply(
    env,
    commandsHelp(env.superAdmin, `你好，我是群验证机器人。\n你的 Telegram ID：<code>${env.userId}</code>\n\n`),
  );
}

async function handleKeys(env: CommandEnv): Promise<void> {
  if (!env.isPrivate) {
    await reply(env, "公钥管理只能在私聊里做。");
    return;
  }
  const keys = await listSshKeys(env.ctx.db, env.userId);
  if (keys.length === 0) {
    await reply(env, "你还没有登记任何 SSH 公钥。打开验证页即可粘贴公钥登记。");
    return;
  }
  const lines = keys.map(
    (k, index) =>
      `${index + 1}. <code>${escapeHtml(k.fingerprint)}</code>\n   ${escapeHtml(k.key_type)} · ${escapeHtml(k.label ?? "无备注")} · 登记于 ${formatDateTime(k.created_at)}`,
  );
  await reply(env, `<b>已登记的公钥</b>\n${lines.join("\n")}\n\n删除：/unlink &lt;指纹&gt;`);
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
  const lines = rows.map(
    (row) =>
      `${formatDateTime(row.ts)} <code>${escapeHtml(row.action)}</code> ${escapeHtml(row.actor_type)} ${row.actor_id}` +
      `${row.target_user_id ? ` → ${row.target_user_id}` : ""}`,
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

async function handleUnlink(env: CommandEnv): Promise<void> {
  const fingerprintArg = env.isPrivate && env.args.length === 1 ? env.args[0] : env.args[1];
  const target = env.args.length >= 2 ? Number.parseInt(env.args[0] ?? "", 10) : env.userId;

  if (!fingerprintArg || !Number.isSafeInteger(target)) {
    await reply(env, "用法：私聊 /unlink <指纹>；管理员 /unlink <用户id> <指纹>");
    return;
  }
  if (target !== env.userId && !env.superAdmin) {
    await reply(env, "只有超管可以删除别人的公钥。");
    return;
  }

  const removed = await deleteSshKey(env.ctx.db, target, fingerprintArg);
  if (!removed) {
    await reply(env, "没找到这把公钥。");
    return;
  }
  await appendAudit(env.ctx.db, {
    actorId: env.userId,
    actorType: env.superAdmin ? "super_admin" : "user",
    action: "ssh_key.deleted",
    chatId: env.chatId,
    targetUserId: target,
    verificationId: null,
    detail: { fingerprint: fingerprintArg },
  });
  await reply(env, "已删除。");
}
