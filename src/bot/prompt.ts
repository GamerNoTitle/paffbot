import { updateVerificationDetail, type VerificationRow } from "../db";
import { appendAudit } from "../db/audit";
import { displayName } from "../lib/html";
import type { TgUser } from "../lib/telegram";
import type { BotContext } from "./context";
import { miniAppUrl } from "./context";
import { dmVerificationPrompt, miniAppKeyboard } from "./messages";

/** 私聊发验证提示（带 Mini App 按钮）。重复调用是安全的：只是再发一条。 */
export async function sendVerificationPrompt(
  ctx: BotContext,
  verification: VerificationRow,
  user: TgUser,
): Promise<boolean> {
  const methods = ctx.providers.list().map((p) => ({ id: p.id, label: p.label, description: p.description }));
  const url = `${miniAppUrl(ctx)}/?chat=${verification.chat_id}`;

  const message = await ctx.tg.trySendMessage({
    chat_id: user.id,
    text: dmVerificationPrompt({
      userName: displayName(user),
      chatTitle: verification.chat_title ?? String(verification.chat_id),
      methods,
      ttlSeconds: ctx.config.ttlSeconds,
    }),
    parse_mode: "HTML",
    reply_markup: miniAppKeyboard(url),
  });

  if (!message) {
    await appendAudit(ctx.db, {
      actorId: 0,
      actorType: "system",
      action: "verification.dm_failed",
      chatId: verification.chat_id,
      targetUserId: verification.user_id,
      verificationId: verification.id,
      detail: { hint: "用户可能未先私聊过 bot，或屏蔽了 bot" },
    });
    return false;
  }

  await updateVerificationDetail(ctx.db, verification.id, { prompt_message_id: message.message_id });
  return true;
}
