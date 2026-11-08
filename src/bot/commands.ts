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
import { approveAdminNonce } from "../db";
import { beginChatVerify } from "./chat-verify";
import { randomToken } from "../lib/crypto";
import { displayName, escapeHtml, truncate } from "../lib/html";
import type { InlineKeyboardMarkup, TgMessage } from "../lib/telegram";
import { formatDateTime } from "../lib/time";
import { approveVerification, rejectVerification } from "../verify/finalize";
import { isGroupAdmin, isSuperAdmin } from "./auth";
import { miniAppUrl, type BotContext } from "./context";
import { botUsername } from "./identity";
import { aboutText, auditLine, commandsHelp, miniAppKeyboard } from "./messages";
import { t } from "../i18n";
import { addAllowedBot, listAllowedBots, removeAllowedBot, type AllowedBotRow } from "../db";
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
        t(env.lang, "cmd.idInfo", {
          chat: String(chat.id),
          user: String(from.id),
          type: escapeHtml(chat.type),
        }),
      );
      return;
    case "pass":
      await handlePass(env);
      return;
    case "ban":
      await handleBan(env);
      return;
    case "allowedbots":
      await handleAllowedList(env);
      return;
    case "addallowedbot":
      await handleAllowedBot(env, true);
      return;
    case "delallowedbot":
      await handleAllowedBot(env, false);
      return;
    case "pending":
      await handlePending(env);
      return;
    case "audit":
      await handleAudit(env);
      return;
    default:
      if (isPrivate) await reply(env, t(env.lang, "cmd.unknown"));
  }
}

async function handleStart(env: CommandEnv): Promise<void> {
  // 网页后台登录：/start admin_<nonce>
  const payload = env.args[0] ?? "";
  if (payload.startsWith("admin_")) {
    const nonce = payload.slice("admin_".length);
    if (!env.superAdmin) {
      await reply(env, t(env.lang, "cmd.admin.denied"));
      return;
    }
    const ticket = Array.from(crypto.getRandomValues(new Uint8Array(16)))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    const approved = await approveAdminNonce(env.ctx.db, nonce, env.userId, ticket);
    if (!approved) {
      await reply(env, t(env.lang, "cmd.admin.expired"));
      return;
    }
    await appendAudit(env.ctx.db, {
      actorId: env.userId,
      actorType: "user",
      action: "admin.login_issued",
      chatId: null,
      targetUserId: env.userId,
      verificationId: null,
      detail: { via: "browser" },
    });
    await reply(
      env,
      t(env.lang, "cmd.admin.issued"),
      { inline_keyboard: [[{ text: t(env.lang, "cmd.admin.open"), url: `${env.ctx.origin}/admin?t=${ticket}` }]] },
    );
    return;
  }

  if (!env.isPrivate) {
    const username = await botUsername(env.ctx.tg);
    await reply(
      env,
      t(env.lang, "cmd.start.group"),
      username
        ? { inline_keyboard: [[{ text: t(env.lang, "cmd.start.dmButton"), url: `https://t.me/${username}?start=verify` }]] }
        : undefined,
    );
    return;
  }

  const wantsChat = env.args[0]?.toLowerCase() === "chat";
  const pending = await findLatestPendingForUser(env.ctx.db, env.userId);

  if (pending) {
    if (wantsChat) {
      // 直接进聊天验证：问用户名，后面走签名
      await beginChatVerify(env.ctx, env.userId, env.lang);
      return;
    }

    const url = `${miniAppUrl(env.ctx)}/?chat=${pending.chat_id}`;
    await reply(
      env,
      t(env.lang, "cmd.start.pendingMini", {
        chat: escapeHtml(pending.chat_title ?? String(pending.chat_id)),
      }),
      miniAppKeyboard(url, t(env.lang, "cmd.start.continue")),
    );
    return;
  }

  await reply(
    env,
    commandsHelp(
      env.superAdmin && !env.isPrivate,
      t(env.lang, "cmd.start.hello", { id: String(env.userId) }),
      env.lang,
    ),
  );

  // 管理员额外给一个审计入口（普通用户看不到这个标签页）
  if (env.superAdmin) {
    await reply(env, t(env.lang, "cmd.start.super"), {
      inline_keyboard: [
        [{ text: t(env.lang, "cmd.start.auditButton"), web_app: { url: `${miniAppUrl(env.ctx)}/admin` } }],
      ],
    });
  }
}

async function handlePass(env: CommandEnv): Promise<void> {
  const auth = await requireAdmin(env);
  if (!auth) {
    await reply(env, t(env.lang, "cmd.groupOnly"));
    return;
  }
  const target = targetUserId(env);
  if (!target) {
    await reply(env, t(env.lang, "cmd.pass.usage"));
    return;
  }

  const pending = await findOpenVerificationForChat(env.ctx.db, env.chatId, target);
  if (pending) {
    await approveVerification({ db: env.ctx.db, tg: env.ctx.tg }, pending, {
      method: "admin_pass",
      actorId: env.userId,
      actorType: auth.actorType,
    });
    await reply(env, t(env.lang, "cmd.pass.done", { target: String(target), id: pending.id.slice(0, 8) }));
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
  await reply(env, t(env.lang, "cmd.pass.manual", { target: String(target) }));
}

async function handleBan(env: CommandEnv): Promise<void> {
  const auth = await requireAdmin(env);
  if (!auth) {
    await reply(env, t(env.lang, "cmd.groupOnly"));
    return;
  }
  const target = targetUserId(env);
  if (!target) {
    await reply(env, t(env.lang, "cmd.ban.usage"));
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
    await reply(env, t(env.lang, "cmd.ban.done", { target: String(target) }));
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
  await reply(env, t(env.lang, "cmd.ban.done", { target: String(target) }));
}

/** /addallowedbot 与 /delallowedbot：回复消息取被回复者，否则用 @用户名 解析。 */
async function handleAllowedBot(env: CommandEnv, adding: boolean): Promise<void> {
  const auth = await requireAdmin(env);
  if (!auth) {
    await reply(env, t(env.lang, "allowed.denied"));
    return;
  }

  const replied = env.message.reply_to_message?.from;
  let botId: number | null = null;
  let botUsername: string | null = null;

  if (replied?.is_bot) {
    botId = replied.id;
    botUsername = replied.username ?? null;
  } else {
    const raw = (env.args[0] ?? "").replace(/^@/, "").trim();
    if (!raw) {
      await reply(env, t(env.lang, "allowed.needTarget"));
      return;
    }
    // 能解析出 id 就一起存，解析不到就只按用户名登记
    try {
      const chat = await env.ctx.tg.getChat(`@${raw}`);
      if (chat && typeof chat.id === "number" && Number.isSafeInteger(chat.id) && chat.id !== 0) {
        botId = chat.id;
        botUsername = typeof chat.username === "string" ? chat.username : raw;
      } else {
        botUsername = raw;
      }
    } catch {
      botUsername = raw;
    }
  }

  if (botId === null && botUsername === null) {
    await reply(env, t(env.lang, "allowed.needTarget"));
    return;
  }

  const label = botUsername ? `@${botUsername}` : String(botId);
  if (adding) {
    await addAllowedBot(env.ctx.db, env.chatId, botId, botUsername, env.userId);
    await appendAudit(env.ctx.db, {
      actorId: env.userId,
      actorType: auth.actorType,
      action: "telegram.bot_allowed",
      chatId: env.chatId,
      targetUserId: botId ?? 0,
      verificationId: null,
      detail: { phase: "command", username: botUsername },
    });
    await reply(env, t(env.lang, "allowed.added", { name: escapeHtml(label), id: botId ?? 0 }));
    return;
  }

  if (botId === null) {
    await reply(env, t(env.lang, "allowed.notFound"));
    return;
  }
  const removed = await removeAllowedBot(env.ctx.db, env.chatId, botId);
  if (!removed) {
    await reply(env, t(env.lang, "allowed.notFound"));
    return;
  }
  await appendAudit(env.ctx.db, {
    actorId: env.userId,
    actorType: auth.actorType,
    action: "telegram.bot_allowed",
    chatId: env.chatId,
    targetUserId: botId,
    verificationId: null,
    detail: { phase: "command_remove", username: botUsername },
  });
  await reply(env, t(env.lang, "allowed.removed", { id: botId }));
}

async function handleAllowedList(env: CommandEnv): Promise<void> {
  const auth = await requireAdmin(env);
  if (!auth) {
    await reply(env, t(env.lang, "allowed.denied"));
    return;
  }
  const bots = await listAllowedBots(env.ctx.db, env.chatId);
  if (bots.length === 0) {
    await reply(env, t(env.lang, "allowed.empty"));
    return;
  }
  const lines = bots.map((b: AllowedBotRow) =>
    t(env.lang, "allowed.listItem", {
      name: escapeHtml(b.username ? `@${b.username}` : String(b.bot_id ?? "")),
      id: b.bot_id ?? 0,
    }),
  );
  await reply(env, t(env.lang, "allowed.list", { count: bots.length, list: lines.join("\n") }));
}

async function handlePending(env: CommandEnv): Promise<void> {
  const auth = await requireAdmin(env);
  if (!auth) {
    await reply(env, t(env.lang, "cmd.groupOnly"));
    return;
  }
  const [count, list] = await Promise.all([
    countPending(env.ctx.db, env.chatId),
    listVerifications(env.ctx.db, { chatId: env.chatId, status: "pending", limit: 10 }),
  ]);
  if (count === 0) {
    await reply(env, t(env.lang, "cmd.pending.none"));
    return;
  }
  const lines = list.rows.map(
    (row) =>
      `• <code>${row.user_id}</code> ${escapeHtml(
        truncate(row.display_name ?? row.username ?? t(env.lang, "cmd.pending.unknown"), 24),
      )} · ${formatDateTime(row.created_at)}`,
  );
  await reply(
    env,
    t(env.lang, "cmd.pending.list", {
      count,
      shown: list.rows.length,
      list: lines.join("\n"),
    }),
  );
}

async function handleAudit(env: CommandEnv): Promise<void> {
  const auth = await requireAdmin(env);
  if (!auth) {
    await reply(env, t(env.lang, "cmd.groupOnly"));
    return;
  }
  const requested = Number.parseInt(env.args[0] ?? "10", 10);
  const limit = Number.isFinite(requested) ? Math.min(50, Math.max(1, requested)) : 10;
  const { rows } = await listAudit(env.ctx.db, { chatId: env.chatId, limit });
  if (rows.length === 0) {
    await reply(env, t(env.lang, "cmd.audit.none"));
    return;
  }
  const lines = rows.map((row) =>
    auditLine(formatDateTime(row.ts), row.action, row.actor_type, row.actor_id, row.target_user_id, env.lang),
  );
  await reply(
    env,
    t(env.lang, "cmd.audit.list", { count: rows.length, list: lines.join("\n") }),
  );
}

