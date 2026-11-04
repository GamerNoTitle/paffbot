import { clearChatVerify, findLatestPendingForUser, getChatVerify } from "../db";
import { escapeHtml } from "../lib/html";
import type { TgMessage } from "../lib/telegram";
import { verifyGithubOwnership } from "../verify/github-verify";
import { approveVerification } from "../verify/finalize";
import { challengeFor } from "../verify/types";
import { botUsername } from "./identity";
import type { BotContext } from "./context";

/** /verify <github 用户名>：把用户名暂存下来，并给出签名命令。 */
export async function startChatVerify(ctx: BotContext, userId: number, username: string): Promise<void> {
  const pending = await findLatestPendingForUser(ctx.db, userId);
  if (!pending) {
    await ctx.tg.trySendMessage({
      chat_id: userId,
      text: "现在没有待验证的入群申请。先在群里点「申请加入」，再回来发 /verify。",
      parse_mode: "HTML",
    });
    return;
  }

  await setChatVerifyRow(ctx, userId, username);
  const challenge = challengeFor(pending);
  const command = `echo "${challenge}" | ssh-keygen -Y sign -f ~/.ssh/id_ed25519 -n file -`;

  await ctx.tg.trySendMessage({
    chat_id: userId,
    text:
      `GitHub 用户名：<code>${escapeHtml(username)}</code>\n` +
      `在终端执行：\n<pre>${escapeHtml(command)}</pre>\n` +
      `然后把 <code>-----BEGIN SSH SIGNATURE-----</code> 开头的整段签名直接发给我（15 分钟内有效）。`,
    parse_mode: "HTML",
  });
}

async function setChatVerifyRow(ctx: BotContext, userId: number, username: string): Promise<void> {
  const { setChatVerify } = await import("../db");
  await setChatVerify(ctx.db, userId, username, ctx.config.ttlSeconds * 1000);
}

/** 私聊里收到 SSHSIG 文本：按暂存的用户名验签并放行。 */
export async function handleChatSignature(ctx: BotContext, message: TgMessage): Promise<void> {
  const from = message.from;
  if (!from) return;

  const row = await getChatVerify(ctx.db, from.id);
  if (!row || row.expires_at <= Date.now()) {
    await ctx.tg.trySendMessage({
      chat_id: from.id,
      text: "先发 <code>/verify 你的GitHub用户名</code>，我才会在这里等你的签名。",
      parse_mode: "HTML",
    });
    return;
  }

  const pending = await findLatestPendingForUser(ctx.db, from.id);
  if (!pending) {
    await clearChatVerify(ctx.db, from.id);
    await ctx.tg.trySendMessage({
      chat_id: from.id,
      text: "这条申请已经失效了，回群里重新点「申请加入」吧。",
      parse_mode: "HTML",
    });
    return;
  }

  const signature = (message.text ?? "").trim();
  const result = await verifyGithubOwnership(ctx.config, row.username, signature, challengeFor(pending));

  if (!result.ok) {
    await ctx.tg.trySendMessage({
      chat_id: from.id,
      text: `签名没通过：${escapeHtml(result.error ?? "校验失败")}\n可以重新发一次签名。`,
      parse_mode: "HTML",
    });
    return;
  }

  const approved = await approveVerification({ db: ctx.db, tg: ctx.tg }, pending, {
    method: "github",
    actorId: from.id,
    actorType: "user",
    proof: {
      githubUsername: row.username,
      fingerprint: result.fingerprint,
      keyType: result.keyType,
      namespace: result.namespace,
      via: "chat",
    },
  });

  await clearChatVerify(ctx.db, from.id);

  await ctx.tg.trySendMessage({
    chat_id: from.id,
    text: approved
      ? `验证通过，已经放行你加入「${escapeHtml(pending.chat_title ?? String(pending.chat_id))}」。`
      : "这条申请已经处理过了，回群里看看状态。",
    parse_mode: "HTML",
  });
}

/** 群里的 /verify：把用户引到私聊。 */
export async function redirectChatVerifyToDm(ctx: BotContext, chatId: number): Promise<void> {
  const username = await botUsername(ctx.tg);
  await ctx.tg.trySendMessage({
    chat_id: chatId,
    text: "聊天验证要在私聊里做。",
    parse_mode: "HTML",
    ...(username
      ? { reply_markup: { inline_keyboard: [[{ text: "打开私聊", url: `https://t.me/${username}?start=chat` }]] } }
      : {}),
  });
}
