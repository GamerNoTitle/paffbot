import {
  consumeDailyQuota,
  createVerification,
  dedupeUpdate,
  findOpenVerificationForChat,
  getVerification,
  decideVerification,
  findRecentlyApprovedForChat,
  parseDetail,
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
import { isGroupAdmin, isSuperAdmin } from "./auth";
import { handleCommand } from "./commands";
import { botUsername } from "./identity";
import { normalizeLang, t } from "../i18n";
import type { BotContext } from "./context";
import { adminKeyboard, adminNotice, dmRateLimited, groupJoinNotice, groupNoticeKeyboard } from "./messages";
import { beginChatVerify, handleChatText } from "./chat-verify";
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
    return;
  }
  if (update.my_chat_member) {
    await handleMyChatMember(ctx, update.my_chat_member);
  }
}

function chatTitleOf(chat: { id: number; title?: string }): string {
  return chat.title ?? String(chat.id);
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

  // 超管不占用每日次数（自测用）
  let remaining: number | undefined;
  if (!isSuperAdmin(ctx.config, user.id)) {
    const quota = await consumeDailyQuota(
      ctx.db,
      `tg:${request.chat.id}:${user.id}`,
      ctx.config.dailyAttempts,
    );
    if (!quota.allowed) {
      await ctx.tg.safe("declineChatJoinRequest", { chat_id: request.chat.id, user_id: user.id });
      await ctx.tg.trySendMessage({ chat_id: user.id, text: dmRateLimited(normalizeLang(user.language_code)), parse_mode: "HTML" });
      await appendAudit(ctx.db, {
        actorId: 0,
        actorType: "system",
        action: "verification.rate_limited",
        chatId: request.chat.id,
        targetUserId: user.id,
        verificationId: null,
        detail: { scope: "telegram", used: quota.used, limit: quota.limit },
      });
      return;
    }
    remaining = quota.limit - quota.used;
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

  await sendVerificationPrompt(ctx, verification, user, remaining);

  const lang = normalizeLang(user.language_code);
  await ctx.tg.trySendMessage({
    chat_id: request.chat.id,
    text: adminNotice({
      chatTitle: chatTitleOf(request.chat),
      userId: user.id,
      userName: displayName(user),
      lang,
    }),
    parse_mode: "HTML",
    reply_markup: adminKeyboard(verification.id, lang),
  });
}

async function handleChatMember(ctx: BotContext, update: TgChatMemberUpdated, updateId: number): Promise<void> {
  const user = update.new_chat_member.user;
  if (user.is_bot) return;

  const wasOutside = update.old_chat_member.status === "left" || update.old_chat_member.status === "kicked";
  const isInside = update.new_chat_member.status === "member" || update.new_chat_member.status === "restricted";
  if (!wasOutside || !isInside) return;

  await upsertGroup(ctx.db, update.chat.id, update.chat.title ?? null);

  const existing = await findOpenVerificationForChat(ctx.db, update.chat.id, user.id);
  if (existing) {
    // 管理员在 Telegram 自己的界面点了通过，人已经进来了：
    // 把这条申请记为通过，别让它挂到超时再把记录改成失败。
    if (existing.source === "join_request") {
      await decideVerification(ctx.db, existing.id, {
        status: "approved",
        method: "admin_pass",
        operatorId: 0,
        detail: { ...parseDetail(existing.detail), via: "telegram_ui" },
      });
      await appendAudit(ctx.db, {
        actorId: 0,
        actorType: "system",
        action: "verification.approved",
        chatId: update.chat.id,
        targetUserId: user.id,
        verificationId: existing.id,
        detail: { via: "telegram_ui" },
      });
    }
    return;
  }

  // 用机器人的按钮或 /pass 放行后，Telegram 还会补一条 chat_member：
  // 这条不能再当成"新入群"，否则刚通过的人会被立刻禁言、再开一轮验证。
  const approvedRecently = await findRecentlyApprovedForChat(ctx.db, update.chat.id, user.id, nowMs() - 10 * 60_000);
  if (approvedRecently) return;

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
  let remaining: number | undefined;
  if (!isSuperAdmin(ctx.config, user.id)) {
    const quota = await consumeDailyQuota(ctx.db, `tg:${chatId}:${user.id}`, ctx.config.dailyAttempts);
    if (!quota.allowed) {
      await ctx.tg.banChatMember(chatId, user.id).catch(() => undefined);
      await ctx.tg.unbanChatMember(chatId, user.id).catch(() => undefined);
      await ctx.tg.trySendMessage({ chat_id: user.id, text: dmRateLimited(normalizeLang(user.language_code)), parse_mode: "HTML" });
      await appendAudit(ctx.db, {
        actorId: 0,
        actorType: "system",
        action: "verification.rate_limited",
        chatId,
        targetUserId: user.id,
        verificationId: null,
        detail: { scope: "telegram", used: quota.used, limit: quota.limit, mode: "group_join" },
      });
      return;
    }
    remaining = quota.limit - quota.used;
  }

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

  await sendVerificationPrompt(ctx, verification, user, remaining);

  const bot = await botUsername(ctx.tg);
  const keyboard = groupNoticeKeyboard(bot, verificationId, normalizeLang(user.language_code));
  const notice = await ctx.tg.trySendMessage({
    chat_id: chatId,
    text: groupJoinNotice({
      lang: normalizeLang(user.language_code),
      userId: user.id,
      userName: displayName(user),
    }),
    parse_mode: "HTML",
    ...(keyboard ? { reply_markup: keyboard } : {}),
  });
  if (notice) {
    await updateVerificationDetail(ctx.db, verificationId, { notice_message_id: notice.message_id });
  }
}

/** bot 被拉进群 / 被提升时的自检提示，顺便把群 id 打出来。 */
async function handleMyChatMember(ctx: BotContext, update: TgChatMemberUpdated): Promise<void> {
  const chat = update.chat;
  if (chat.type === "private") return;
  if (update.old_chat_member.status !== "left" && update.old_chat_member.status !== "kicked") return;
  if (update.new_chat_member.status !== "member" && update.new_chat_member.status !== "administrator") return;

  await upsertGroup(ctx.db, chat.id, chat.title ?? null);

  const title = chatTitleOf(chat);
  const isAdmin = update.new_chat_member.status === "administrator";
  const lines = [
    `已加入「<b>${title}</b>」。`,
    `群 ID：<code>${chat.id}</code>`,
    isAdmin
      ? "我已是被管理员，请确认勾选了：Invite Users（批准申请）、Restrict Members（禁言/踢人）、Delete Messages。"
      : "我现在还不是管理员，请在群设置里给我管理员权限，并勾选 Invite Users / Restrict Members。",
    "",
    "验证入口：用户点「申请加入」后我会私聊发按钮；直接入群模式下请让用户先私聊我发 /start。",
    "管理员命令：/pass /ban /pending /audit（在群里用）。",
    "查看 id：群里发 /id。",
  ];

  await ctx.tg.trySendMessage({ chat_id: chat.id, text: lines.join("\n"), parse_mode: "HTML" });
  await appendAudit(ctx.db, {
    actorId: update.from.id,
    actorType: "group_admin",
    action: "bot.added_to_chat",
    chatId: chat.id,
    targetUserId: null,
    verificationId: null,
    detail: { title, isAdmin },
  });
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
    return;
  }

  // 私聊里的普通文本：聊天验证（先收用户名，再收签名）
  if (message.chat.type === "private") {
    await handleChatText(ctx, message);
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

  // 聊天验证按钮由申请人自己点，不走管理员校验
  if (action === "chat") {
    if (verification.user_id !== query.from.id) {
      await ctx.tg.answerCallbackQuery(query.id, "这不是你的验证", true);
      return;
    }
    if (verification.status !== "pending") {
      await ctx.tg.answerCallbackQuery(query.id, "这条记录已经处理过了");
      return;
    }
    await beginChatVerify(ctx, query.from.id, normalizeLang(query.from.language_code));
    await ctx.tg.answerCallbackQuery(query.id, "把 GitHub 用户名发给我");
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

  const lang = normalizeLang(query.from.language_code);

  if (action === "ap") {
    await approveVerification({ db: ctx.db, tg: ctx.tg }, verification, {
      method: "admin_pass",
      actorId: query.from.id,
      actorType: "group_admin",
    });
    await ctx.tg.answerCallbackQuery(query.id, t(lang, "admin.done.approve"));
    return;
  }

  if (action === "rj") {
    await rejectVerification({ db: ctx.db, tg: ctx.tg }, verification, {
      status: "declined",
      method: "admin_reject",
      reason: "admin_reject",
      actorId: query.from.id,
      actorType: "group_admin",
    });
    await ctx.tg.answerCallbackQuery(query.id, t(lang, "admin.done.reject"));
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
    await ctx.tg.answerCallbackQuery(query.id, t(lang, "admin.done.ban"));
    return;
  }

  await ctx.tg.answerCallbackQuery(query.id, "未知操作");
}
