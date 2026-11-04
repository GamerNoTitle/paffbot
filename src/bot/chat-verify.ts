import {
  clearChatVerify,
  findLatestPendingForUser,
  getChatVerify,
  setChatVerify,
  type ChatVerifyRow,
} from "../db";
import { appendAudit } from "../db/audit";
import { isValidGithubUsername, normalizeGithubUsername } from "../lib/github";
import { escapeHtml } from "../lib/html";
import type { TgMessage } from "../lib/telegram";
import { approveVerification } from "../verify/finalize";
import { verifyGithubOwnership } from "../verify/github-verify";
import { challengeFor } from "../verify/types";
import type { BotContext } from "./context";
import { botUsername } from "./identity";

function signCommand(challenge: string): string {
  return `echo "${challenge}" | ssh-keygen -Y sign -f ~/.ssh/id_ed25519 -n file -`;
}

async function say(ctx: BotContext, chatId: number, text: string): Promise<void> {
  await ctx.tg.trySendMessage({ chat_id: chatId, text, parse_mode: "HTML" });
}

/** 点「通过聊天验证」按钮后的第一步：先要 GitHub 用户名。 */
export async function beginChatVerify(ctx: BotContext, userId: number): Promise<void> {
  const pending = await findLatestPendingForUser(ctx.db, userId);
  if (!pending) {
    await say(ctx, userId, "现在没有待验证的入群申请。先在群里点「申请加入」，再回来点按钮。");
    return;
  }

  await setChatVerify(ctx.db, userId, "", "username", ctx.config.ttlSeconds * 1000);
  await say(ctx, userId, "把你的 <b>GitHub 用户名</b>发给我（不带 @，例如 <code>octocat</code>）。");
}

/** /verify <用户名>：跳过问名字这一步，直接给签名命令。 */
export async function startChatVerify(ctx: BotContext, userId: number, username: string): Promise<void> {
  const pending = await findLatestPendingForUser(ctx.db, userId);
  if (!pending) {
    await say(ctx, userId, "现在没有待验证的入群申请。先在群里点「申请加入」，再回来发这条命令。");
    return;
  }

  await sendSignCommand(ctx, userId, username);
}

async function sendSignCommand(ctx: BotContext, userId: number, username: string): Promise<void> {
  const pending = await findLatestPendingForUser(ctx.db, userId);
  if (!pending) return;

  await setChatVerify(ctx.db, userId, username, "signature", ctx.config.ttlSeconds * 1000);
  await say(
    ctx,
    userId,
    `GitHub 用户名：<code>${escapeHtml(username)}</code>\n` +
      `在终端执行：\n<pre>${escapeHtml(signCommand(challengeFor(pending)))}</pre>\n` +
      `然后把 <code>-----BEGIN SSH SIGNATURE-----</code> 开头的整段签名发给我。`,
  );
}

/** 私聊里的普通文本：按阶段解释成「用户名」或「签名」。 */
export async function handleChatText(ctx: BotContext, message: TgMessage): Promise<void> {
  const from = message.from;
  if (!from) return;

  const text = (message.text ?? "").trim();
  if (!text) return;

  const row: ChatVerifyRow | null = await getChatVerify(ctx.db, from.id);
  const hasSignature = text.includes("BEGIN SSH SIGNATURE");

  if (!row || row.expires_at <= Date.now()) {
    if (hasSignature) {
      await say(ctx, from.id, "这条签名没有对应的验证会话。先点「通过聊天验证」，或发 <code>/verify 用户名</code>。");
    }
    return;
  }

  if (row.stage === "username") {
    const name = normalizeGithubUsername(text.split(/\s+/)[0] ?? "");
    if (!isValidGithubUsername(name)) {
      await say(ctx, from.id, "这不是有效的 GitHub 用户名，再发一次（不带 @，例如 <code>octocat</code>）。");
      return;
    }
    await sendSignCommand(ctx, from.id, name);
    return;
  }

  if (!hasSignature) {
    await say(ctx, from.id, "现在等你的签名。把 <code>-----BEGIN SSH SIGNATURE-----</code> 开头的那段整段发给我。");
    return;
  }

  const pending = await findLatestPendingForUser(ctx.db, from.id);
  if (!pending) {
    await clearChatVerify(ctx.db, from.id);
    await say(ctx, from.id, "这条申请已经失效了，回群里重新点「申请加入」吧。");
    return;
  }

  const result = await verifyGithubOwnership(ctx.config, row.username, text, challengeFor(pending));
  if (!result.ok) {
    // 记一下原文特征，方便排查客户端粘贴时被“美化”的情况
    await appendAudit(ctx.db, {
      actorId: from.id,
      actorType: "user",
      action: "verification.failed",
      chatId: pending.chat_id,
      targetUserId: from.id,
      verificationId: pending.id,
      detail: {
        via: "chat",
        error: result.error,
        textLength: text.length,
        head: text.slice(0, 24),
        tail: text.slice(-24),
      },
    });
    await say(
      ctx,
      from.id,
      `签名没通过：${escapeHtml(result.error ?? "校验失败")}\n可以重新发一次签名。`,
    );
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

  // 成功时 approveVerification 已经会私聊通知，这里不再重复发
  if (!approved) {
    await say(ctx, from.id, "这条申请已经处理过了，回群里看看状态。");
  }
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
