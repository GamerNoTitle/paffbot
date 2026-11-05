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
import { normalizeLang, t, type Lang, DEFAULT_LANG } from "../i18n";

function signCommand(challenge: string): string {
  return `echo "${challenge}" | ssh-keygen -Y sign -f ~/.ssh/id_ed25519 -n file -`;
}

async function say(ctx: BotContext, chatId: number, text: string): Promise<void> {
  await ctx.tg.trySendMessage({ chat_id: chatId, text, parse_mode: "HTML" });
}

/** 点「通过聊天验证」按钮后的第一步：先要 GitHub 用户名。 */
export async function beginChatVerify(ctx: BotContext, userId: number, lang: Lang = DEFAULT_LANG): Promise<void> {
  const pending = await findLatestPendingForUser(ctx.db, userId);
  if (!pending) {
    await say(ctx, userId, t(lang, "chat.noPending"));
    return;
  }

  await setChatVerify(ctx.db, userId, "", "username", ctx.config.ttlSeconds * 1000);
  await say(ctx, userId, t(lang, "chat.askName"));
}

async function sendSignCommand(
  ctx: BotContext,
  userId: number,
  username: string,
  lang: Lang = DEFAULT_LANG,
): Promise<void> {
  const pending = await findLatestPendingForUser(ctx.db, userId);
  if (!pending) return;

  await setChatVerify(ctx.db, userId, username, "signature", ctx.config.ttlSeconds * 1000);
  await say(
    ctx,
    userId,
    t(lang, "chat.signCommand", {
      username: escapeHtml(username),
      command: escapeHtml(signCommand(challengeFor(pending))),
    }),
  );
}

/** 私聊里的普通文本：按阶段解释成「用户名」或「签名」。 */
export async function handleChatText(ctx: BotContext, message: TgMessage): Promise<void> {
  const from = message.from;
  if (!from) return;

  const text = (message.text ?? "").trim();
  if (!text) return;

  const lang = normalizeLang(from.language_code);

  const row: ChatVerifyRow | null = await getChatVerify(ctx.db, from.id);
  const hasSignature = text.includes("BEGIN SSH SIGNATURE");

  if (!row || row.expires_at <= Date.now()) {
    if (hasSignature) {
      await say(ctx, from.id, "我不知道这段签名对应哪次申请。先点「通过聊天验证」，或者发 <code>/verify 用户名</code>。");
    }
    return;
  }

  if (row.stage === "username") {
    const name = normalizeGithubUsername(text.split(/\s+/)[0] ?? "");
    if (!isValidGithubUsername(name)) {
      await say(ctx, from.id, t(lang, "chat.badUsername"));
      return;
    }
    await sendSignCommand(ctx, from.id, name, lang);
    return;
  }

  if (!hasSignature) {
    await say(ctx, from.id, t(lang, "chat.needSignature"));
    return;
  }

  const pending = await findLatestPendingForUser(ctx.db, from.id);
  if (!pending) {
    await clearChatVerify(ctx.db, from.id);
    await say(ctx, from.id, t(lang, "chat.expired"));
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
    await say(ctx, from.id, t(lang, "chat.failed", { error: escapeHtml(result.error ?? "") }));
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
    await say(ctx, from.id, t(lang, "chat.alreadyHandled"));
  }
}
