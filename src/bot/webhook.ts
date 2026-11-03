import {
  createVerification,
  dedupeUpdate,
  findOpenVerificationForChat,
  getVerification,
  updateVerificationDetail,
  upsertGroup,
  type VerificationRow,
} from "../db";
import { appendAudit } from "../db/audit";
import { randomToken } from "../lib/crypto";
import { displayName } from "../lib/html";
import { screenProfile } from "../lib/screen";
import {
  MUTED_PERMISSIONS,
  type TelegramApi,
  type TgCallbackQuery,
  type TgChatJoinRequest,
  type TgChatMemberUpdated,
  type TgMessage,
  type TgUpdate,
  type TgUser,
} from "../lib/telegram";
import { nowMs, toUnixSeconds } from "../lib/time";
import { approveVerification, rejectVerification } from "../verify/finalize";
import { isGroupAdmin } from "./auth";
import { handleCommand } from "./commands";
import type { BotContext } from "./context";
import { groupJoinNotice } from "./messages";
import { sendVerificationPrompt } from "./prompt";

export async function handleUpdate(ctx: BotContext, update: TgUpdate): Promise<void> {
  if (!(await dedupeUpdate(ctx.db, update.update_id))) return;

  if (update.chat_join_request) {
    await handleJoinRequest(ctx, update.chat_join_request, update.update_id);
    return;
  }
  if (update.chat_member) {
    await handleChatMember(ctx, update.chat_member, update.update_id);
    return;
  }
  if (update.message) {
    await handleMessage(ctx, update.message, update.update_id);
    return;
  }
  if (update.callback_query) {
    await handleCallback(ctx, update.callback_query);
  }
}

function chatTitleOf(chat: { id: number; title?: string }): string {
  return chat.title ?? String(chat.id);
}

let cachedBotUsername: string | null | undefined;
async function botUsername(ctx: BotContext): Promise<string | null> {
  if (cachedBotUsername !== undefined) return cachedBotUsername;
  try {
    const me = await ctx.tg.getMe();
    cachedBotUsername = me.username ?? null;
  } catch {
    cachedBotUsername = null;
  }
  return cachedBotUsername;
}

async function handleJoinRequest(ctx: BotContext, request: TgChatJoinRequest, updateId: number): Promise<void> {
  const user = request.from;
  if (user.is_bot) {
    await ctx.tg.safe("declineChatJoinRequest", { chat_id: request.chat.id, user_id: user.id });
    return;
  }

  const chatTitle = chatTitleOf(request.chat);
  await upsertGroup(ctx.db, request.chat.id, request.chat.title ?? null);

  // 同一个人重复点"申请加入"：不新建记录，重发一次提示即可
  const existing = await findOpenVerificationForChat(ctx.db, request.chat.id, user.id);
  if (existing) {
    await sendVerificationPrompt(ctx, existing, user);
    return;
  }

  const verificationId = crypto.randomUUID();
  const createdAt = nowMs();
  const expiresAt = createdAt + ctx.config.ttlSeconds * 1000;

  await createVerification(ctx.db, {
    id: verificationId,
    chatId: request.chat.id,
    chatTitle,
    userId: user.id,
    username: user.username ?? null,
    displayName: displayName(user),
    status: "pending",
    source: "join_request",
    updateId,
    nonce: randomToken(16),
    createdAt,
    expiresAt,
    detail: { bio: request.bio ?? null },
  });

  const verification = await getVerification(ctx.db, verificationId);
  if (!verification) return;

  await appendAudit(ctx.db, {
    actorId: 0,
    actorType: "system",
    action: "verification.created",
    chatId: request.chat.id,
    targetUserId: user.id,
    verificationId,
    detail: { source: "join_request", username: user.username ?? null },
  });

  const screening = screenProfile(
    {
      firstName: user.first_name,
      lastName: user.last_name,
      username: user.username,
      bio: request.bio,
    },
    ctx.config.screenKeywords,
  );

  if (screening.blocked) {
    await rejectVerification(ctx, verification, {
      status: "blocked",
      method: "profile",
      reason: screening.reason ?? "profile",
      actorId: 0,
      actorType: "system",
    });
    return;
  }

  await sendVerificationPrompt(ctx, verification, user);
}

async function handleChatMember(ctx: BotContext, update: TgChatMemberUpdated, updateId: number): Promise<void> {
  const user = update.new_chat_member.user;
  if (user.is_bot) return;

  const wasOutside = update.old_chat_member.status === "left" || update.old_chat_member.status === "kicked";
  const isInside = update.new_chat_member.status === "member" || update.new_chat_member.status === "restricted";
  if (!wasOutside || !isInside) return;

  await upsertGroup(ctx.db, update.chat.id, update.chat.title ?? null);

  const existing = await findOpenVerificationForChat(ctx.db, update.chat.id, user.id);
  if (existing) return;

  await startDirectJoinVerification(ctx, update.chat.id, update.chat.title ?? String(update.chat.id), user, updateId);
}

/** 直接入群模式：先禁言，再私聊发验证按钮；超时由 cron 移出。 */
async function startDirectJoinVerification(
  ctx: BotContext,
  chatId: number,
  chatTitle: string,
  user: TgUser,
  updateId: number | null,
): Promise<void> {
  const verificationId = crypto.randomUUID();
  const createdAt = nowMs();
  const expiresAt = createdAt + ctx.config.ttlSeconds * 1000;

  await createVerification(ctx.db, {
    id: verificationId,
    chatId,
    chatTitle,
    userId: user.id,
    username: user.username ?? null,
    displayName: displayName(user),
    status: "pending",
    source: "group_join",
    updateId,
    nonce: randomToken(16),
    createdAt,
    expiresAt,
  });

  const verification = await getVerification(ctx.db, verificationId);
  if (!verification) return;

  await appendAudit(ctx.db, {
    actorId: 0,
    actorType: "system",
    action: "verification.created",
    chatId,
    targetUserId: user.id,
    verificationId,
    detail: { source: "group_join", username: user.username ?? null },
  });

  try {
    await ctx.tg.restrictChatMember(chatId, user.id, toUnixSeconds(expiresAt + 60_000));
  } catch (err) {
    await appendAudit(ctx.db, {
      actorId: 0,
      actorType: "system",
      action: "telegram.action_failed",
      chatId,
      targetUserId: user.id,
      verificationId,
      detail: { phase: "restrict", error: err instanceof Error ? err.message : String(err) },
    });
  }

  await sendVerificationPrompt(ctx, verification, user);

  const notice = await ctx.tg.trySendMessage({
    chat_id: chatId,
    text: groupJoinNotice({
      userId: user.id,
      userName: displayName(user),
      ttlSeconds: ctx.config.ttlSeconds,
      botUsername: await botUsername(ctx),
    }),
    parse_mode: "HTML",
  });
  if (notice) {
    await updateVerificationDetail(ctx.db, verificationId, { notice_message_id: notice.message_id });
  }
}

async function handleMessage(ctx: BotContext, message: TgMessage, updateId: number): Promise<void> {
  const from = message.from;
  if (!from || from.is_bot) return;

  if (message.new_chat_members?.length) {
    const chatTitle = chatTitleOf(message.chat);
    await upsertGroup(ctx.db, message.chat.id, message.chat.title ?? null);
    for (const member of message.new_chat_members) {
      if (member.is_bot) continue;
      const existing = await findOpenVerificationForChat(ctx.db, message.chat.id, member.id);
      if (existing) continue;
      await startDirectJoinVerification(ctx, message.chat.id, chatTitle, member, updateId);
    }
    return;
  }

  if (message.text?.startsWith("/")) {
    await handleCommand(ctx, message, updateId);
  }
}

async function handleCallback(ctx: BotContext, query: TgCallbackQuery): Promise<void> {
  const data = query.data ?? "";
  const [action, verificationId] = data.split(":");
  if (!action || !verificationId) {
    await ctx.tg.answerCallbackQuery(query.id, "无效的操作");
    return;
  }

  const verification = await getVerification(ctx.db, verificationId);
  if (!verification) {
    await ctx.tg.answerCallbackQuery(query.id, "记录不存在或已过期", true);
    return;
  }

  const admin = await isGroupAdmin({ config: ctx.config, db: ctx.db, tg: ctx.tg }, verification.chat_id, query.from.id);
  if (!admin) {
    await ctx.tg.answerCallbackQuery(query.id, "只有群管理员可以操作", true);
    return;
  }

  if (verification.status !== "pending") {
    await ctx.tg.answerCallbackQuery(query.id, "这条记录已经处理过了");
    return;
  }

  if (action === "ap") {
    await approveVerification({ db: ctx.db, tg: ctx.tg }, verification, {
      method: "admin_pass",
      actorId: query.from.id,
      actorType: "group_admin",
    });
    await ctx.tg.answerCallbackQuery(query.id, "已放行");
    return;
  }

  if (action === "bn") {
    await rejectVerification({ db: ctx.db, tg: ctx.tg }, verification, {
      status: "banned",
      method: "admin_ban",
      reason: "admin_ban",
      actorId: query.from.id,
      actorType: "group_admin",
    });
    await ctx.tg.answerCallbackQuery(query.id, "已封禁");
    return;
  }

  await ctx.tg.answerCallbackQuery(query.id, "未知操作");
}
