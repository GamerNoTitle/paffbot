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
import { addAllowedBot, matchAllowedBot } from "../db";
import { randomToken } from "../lib/crypto";
import { displayName } from "../lib/html";
import { screenProfile } from "../lib/screen";
import {
  MUTED_PERMISSIONS,
  type TelegramApi,
  type TgCallbackQuery,
  type TgChatJoinRequest,
  type TgChatMemberInfo,
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
import {
  adminKeyboard,
  adminNotice,
  dmRateLimited,
  groupJoinNotice,
  groupNoticeKeyboard,
  requestNoticeKeyboard,
} from "./messages";
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

  // 刚通过就重投的申请（或通过后立刻再申请）：直接放行，不占次数、不再发提示
  if (await findRecentlyApprovedForChat(ctx.db, request.chat.id, user.id, nowMs() - 10 * 60_000)) {
    await ctx.tg.safe("approveChatJoinRequest", { chat_id: request.chat.id, user_id: user.id });
    await appendAudit(ctx.db, {
      actorId: 0,
      actorType: "system",
      action: "verification.approved",
      chatId: request.chat.id,
      targetUserId: user.id,
      verificationId: null,
      detail: { method: "admin_pass", via: "redelivered" },
    });
    return;
  }

  // 同一个人重复点"申请加入"：不新建记录，也不再发第二条私聊（窗口内只发第一条）
  const existing = await findOpenVerificationForChat(ctx.db, request.chat.id, user.id);
  if (existing) return;

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

  const screening = ctx.config.screenEnabled
    ? screenProfile(
        {
          firstName: user.first_name,
          lastName: user.last_name,
          username: user.username,
          bio: request.bio,
        },
        ctx.config.screenKeywords,
      )
    : { blocked: false as const, reason: undefined };

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

  // 入群审核的更新里带 user_chat_id，5 分钟内可以用它直接私聊用户
  await sendVerificationPrompt(ctx, verification, user, remaining, request.user_chat_id);

  const lang = normalizeLang(user.language_code);
  const notice = adminNotice({ userId: user.id, userName: displayName(user), lang });
  const adminMsg = await ctx.tg.trySendMessage({
    chat_id: request.chat.id,
    text: notice.text,
    parse_mode: "HTML",
    reply_markup: requestNoticeKeyboard(verification.id, lang),
  });
  if (adminMsg) {
    await updateVerificationDetail(ctx.db, verification.id, { admin_message_id: adminMsg.message_id });
  }
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


  // 直接入群模式：同一个人已经进来了，扫到广告词就直接移出，不再走验证
  if (ctx.config.screenEnabled) {
    const screening = screenProfile(
      { firstName: user.first_name, lastName: user.last_name, username: user.username },
      ctx.config.screenKeywords,
    );
    if (screening.blocked) {
      await ctx.tg.banChatMember(update.chat.id, user.id);
      await appendAudit(ctx.db, {
        actorId: 0,
        actorType: "system",
        action: "verification.blocked",
        chatId: update.chat.id,
        targetUserId: user.id,
        verificationId: null,
        detail: { source: "group_join", reason: screening.reason ?? "profile", via: "profile" },
      });
      return;
    }
  }

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
  // 放行和 chat_member 可能几乎同时到，进这里前再确认一次，避免把刚放行的人当成新入群
  if (await findRecentlyApprovedForChat(ctx.db, chatId, user.id, nowMs() - 10 * 60_000)) return;
  if (await findOpenVerificationForChat(ctx.db, chatId, user.id)) return;

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

  // 先把群里的「前往验证」按钮发出去：没跟机器人说过话的用户收不到私聊
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

  // 直接入群模式不主动私聊：没跟机器人说过话的用户收不到，统一让用户点群里的按钮
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
  const lang = normalizeLang(update.from.language_code);
  const lines = [
    t(lang, "bot.added.head", { title }),
    t(lang, "bot.added.chatId", { id: String(chat.id) }),
    isAdmin ? t(lang, "bot.added.adminYes") : t(lang, "bot.added.adminNo"),
    "",
    t(lang, "bot.added.howJoin"),
    t(lang, "bot.added.commands"),
    t(lang, "bot.added.howId"),
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
  // 以频道身份在群里发言：频道成员不在群里，直接删消息并封禁这个频道
  if (message.sender_chat?.type === "channel") {
    await handleChannelSender(ctx, message);
    return;
  }

  const from = message.from;
  if (!from) return;

  // 群里出现 bot 发言：不是白名单、也不是管理员 → 删消息并封禁这个 bot
  if (from.is_bot) {
    await handleBotSender(ctx, message);
    return;
  }

  if (message.new_chat_members?.length) {
    const chatTitle = chatTitleOf(message.chat);
    await upsertGroup(ctx.db, message.chat.id, message.chat.title ?? null);
    for (const member of message.new_chat_members) {
      if (member.is_bot) {
        // 公开群有人用 /start @bot 把 bot 拉进来发广告：不是管理员拉的就直接踢
        const allowed =
          ctx.config.allowedBotIds.includes(member.id) ||
          (await matchAllowedBot(ctx.db, message.chat.id, member.id, member.username ?? null));
        if (allowed) continue;

        const adderIsAdmin = from ? await isGroupAdmin(ctx, message.chat.id, from.id) : false;
        if (adderIsAdmin) {
          await addAllowedBot(ctx.db, message.chat.id, member.id, member.username ?? null, from?.id ?? null);
          await appendAudit(ctx.db, {
            actorId: from?.id ?? 0,
            actorType: "group_admin",
            action: "telegram.bot_allowed",
            chatId: message.chat.id,
            targetUserId: member.id,
            verificationId: null,
            detail: { phase: "added_by_admin", username: member.username ?? null },
          });
          continue;
        }

        await ctx.tg.banChatMember(message.chat.id, member.id);
        await appendAudit(ctx.db, {
          actorId: from?.id ?? 0,
          actorType: "user",
          action: "telegram.bot_kicked",
          chatId: message.chat.id,
          targetUserId: member.id,
          verificationId: null,
          detail: { phase: "added_by_member", username: member.username ?? null, adder: from?.id ?? null },
        });
        continue;
      }

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

/** 群里出现 bot 发言：白名单或管理员放行，其余删消息 + 封禁。 */
async function handleBotSender(ctx: BotContext, message: TgMessage): Promise<void> {
  const sender = message.from;
  if (!sender) return;
  if (message.chat.type === "private") return;
  if (ctx.config.allowedBotIds.includes(sender.id)) return;
  if (await matchAllowedBot(ctx.db, message.chat.id, sender.id, sender.username ?? null)) return;

  const member = await ctx.tg.safe<TgChatMemberInfo>("getChatMember", {
    chat_id: message.chat.id,
    user_id: sender.id,
  });
  // 查不到成员状态（接口失败/机器人刚被移出）就不动手：宁可漏杀，不能误封管理员 bot
  if (!member) return;
  if (member.status === "administrator" || member.status === "creator") return;

  await ctx.tg.deleteMessage(message.chat.id, message.message_id);
  await ctx.tg.banChatMember(message.chat.id, sender.id);

  await appendAudit(ctx.db, {
    actorId: 0,
    actorType: "system",
    action: "telegram.bot_banned",
    chatId: message.chat.id,
    targetUserId: sender.id,
    verificationId: null,
    detail: {
      phase: "bot_post",
      username: sender.username ?? null,
      name: displayName(sender),
      message_id: message.message_id,
      preview: (message.text ?? "").slice(0, 120),
    },
  });
}

/** 群里出现"频道发言"：不是本群关联频道就删掉 + 封禁该频道。 */
async function handleChannelSender(ctx: BotContext, message: TgMessage): Promise<void> {
  const sender = message.sender_chat;
  if (!sender) return;

  // 本群自己关联的频道是合法的，放过
  const chat = await ctx.tg.safe<{ linked_chat_id?: number }>("getChat", { chat_id: message.chat.id });
  if (chat && chat.linked_chat_id && chat.linked_chat_id === sender.id) return;

  await ctx.tg.deleteMessage(message.chat.id, message.message_id);
  await ctx.tg.banChatSenderChat(message.chat.id, sender.id);

  await appendAudit(ctx.db, {
    actorId: 0,
    actorType: "system",
    action: "telegram.channel_banned",
    chatId: message.chat.id,
    targetUserId: sender.id,
    verificationId: null,
    detail: {
      phase: "channel_post",
      sender_chat_id: sender.id,
      sender_title: sender.title ?? null,
      message_id: message.message_id,
      preview: (message.text ?? "").slice(0, 120),
    },
  });
}

async function handleCallback(ctx: BotContext, query: TgCallbackQuery): Promise<void> {
  const lang = normalizeLang(query.from.language_code);
  const data = query.data ?? "";
  const [action, verificationId] = data.split(":");
  if (!action || !verificationId) {
    await ctx.tg.answerCallbackQuery(query.id, t(lang, "cb.invalid"));
    return;
  }

  const verification = await getVerification(ctx.db, verificationId);
  if (!verification) {
    await ctx.tg.answerCallbackQuery(query.id, t(lang, "cb.missing"), true);
    return;
  }

  // 聊天验证按钮由申请人自己点，不走管理员校验
  if (action === "chat") {
    if (verification.user_id !== query.from.id) {
      await ctx.tg.answerCallbackQuery(query.id, t(lang, "cb.notYours"), true);
      return;
    }
    if (verification.status !== "pending") {
      await ctx.tg.answerCallbackQuery(query.id, t(lang, "cb.done"));
      return;
    }
    await beginChatVerify(ctx, query.from.id, normalizeLang(query.from.language_code));
    await ctx.tg.answerCallbackQuery(query.id, t(lang, "cb.needUsername"));
    return;
  }

  const admin = await isGroupAdmin({ config: ctx.config, db: ctx.db, tg: ctx.tg }, verification.chat_id, query.from.id);
  if (!admin) {
    await ctx.tg.answerCallbackQuery(query.id, t(lang, "cb.adminOnly"), true);
    return;
  }

  if (verification.status !== "pending") {
    await ctx.tg.answerCallbackQuery(query.id, t(lang, "cb.done"));
    return;
  }

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

  await ctx.tg.answerCallbackQuery(query.id, t(lang, "cb.unknown"));
}
