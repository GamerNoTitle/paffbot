import { decideVerification, getVerification, parseDetail, type VerificationRow } from "../db";
import { appendAudit, type ActorType } from "../db/audit";
import { dmApproved, dmBlocked, dmRejected, dmTimeout } from "../bot/messages";
import type { TelegramApi } from "../lib/telegram";

/**
 * 状态机的唯一出口：所有"放行 / 拒绝"都必须走这里，才能保证
 *   1) CAS 更新只生效一次（webhook 重投不会重复放行）
 *   2) Telegram 侧动作与数据库状态一致
 *   3) 审计一定落库，且带 operator
 */

export interface FinalizeDeps {
  db: D1Database;
  tg: TelegramApi;
}

export interface ApproveOptions {
  method: string;
  actorId: number;
  actorType: ActorType;
  proof?: Record<string, unknown>;
  notify?: boolean;
}

export async function approveVerification(
  deps: FinalizeDeps,
  verification: VerificationRow,
  options: ApproveOptions,
): Promise<boolean> {
  const row = await getVerification(deps.db, verification.id);
  if (!row || row.status !== "pending") return false;

  const detail = { ...parseDetail(row.detail), proof: options.proof ?? null };
  const changed = await decideVerification(deps.db, row.id, {
    status: "approved",
    method: options.method,
    detail,
  });
  if (!changed) return false;

  try {
    if (row.source === "join_request") {
      await deps.tg.approveChatJoinRequest(row.chat_id, row.user_id);
    } else if (row.source === "group_join") {
      await deps.tg.unrestrictChatMember(row.chat_id, row.user_id);
    }
  } catch (err) {
    console.warn(`[finalize] 放行动作失败 verification=${row.id}:`, err instanceof Error ? err.message : err);
    await appendAudit(deps.db, {
      actorId: 0,
      actorType: "system",
      action: "telegram.action_failed",
      chatId: row.chat_id,
      targetUserId: row.user_id,
      verificationId: row.id,
      detail: { phase: "approve", error: err instanceof Error ? err.message : String(err) },
    });
  }

  await appendAudit(deps.db, {
    actorId: options.actorId,
    actorType: options.actorType,
    action: "verification.approved",
    chatId: row.chat_id,
    targetUserId: row.user_id,
    verificationId: row.id,
    detail: { method: options.method, source: row.source, proof: options.proof ?? null },
  });

  // 直接入群模式下群里那条"请验证"的提示，放行后删掉保持群面干净
  const noticeId = parseDetail(row.detail).notice_message_id;
  if (typeof noticeId === "number") {
    await deps.tg.deleteMessage(row.chat_id, noticeId);
  }

  if (options.notify !== false) {
    await deps.tg.trySendMessage({
      chat_id: row.user_id,
      text: dmApproved(row.chat_title ?? String(row.chat_id)),
      parse_mode: "HTML",
    });
  }
  return true;
}

export type RejectStatus = "declined" | "timeout" | "banned" | "blocked";

export interface RejectOptions {
  status: RejectStatus;
  method: string;
  reason: string;
  actorId: number;
  actorType: ActorType;
  notify?: boolean;
}

export async function rejectVerification(
  deps: FinalizeDeps,
  verification: VerificationRow,
  options: RejectOptions,
): Promise<boolean> {
  const row = await getVerification(deps.db, verification.id);
  if (!row || row.status !== "pending") return false;

  const changed = await decideVerification(deps.db, row.id, {
    status: options.status,
    method: options.method,
    reason: options.reason,
  });
  if (!changed) return false;

  // 申请模式必须先撤回申请；直接入群模式的"移出" = ban 再 unban（可再次申请）
  try {
    if (row.source === "join_request") {
      await deps.tg.declineChatJoinRequest(row.chat_id, row.user_id);
      if (options.status === "banned" || options.status === "blocked") {
        await deps.tg.banChatMember(row.chat_id, row.user_id);
      }
    } else {
      if (options.status === "banned" || options.status === "blocked") {
        await deps.tg.banChatMember(row.chat_id, row.user_id);
      } else {
        await deps.tg.banChatMember(row.chat_id, row.user_id);
        await deps.tg.unbanChatMember(row.chat_id, row.user_id);
      }
    }
  } catch (err) {
    console.warn(`[finalize] 移除动作失败 verification=${row.id}:`, err instanceof Error ? err.message : err);
    await appendAudit(deps.db, {
      actorId: 0,
      actorType: "system",
      action: "telegram.action_failed",
      chatId: row.chat_id,
      targetUserId: row.user_id,
      verificationId: row.id,
      detail: { phase: options.status, error: err instanceof Error ? err.message : String(err) },
    });
  }

  await appendAudit(deps.db, {
    actorId: options.actorId,
    actorType: options.actorType,
    action: `verification.${options.status}`,
    chatId: row.chat_id,
    targetUserId: row.user_id,
    verificationId: row.id,
    detail: { reason: options.reason, source: row.source, method: options.method },
  });

  if (options.notify !== false) {
    const title = row.chat_title ?? String(row.chat_id);
    const text =
      options.status === "timeout"
        ? dmTimeout(title)
        : options.status === "blocked"
          ? dmBlocked(title, options.reason)
          : dmRejected(title, options.reason);
    await deps.tg.trySendMessage({ chat_id: row.user_id, text, parse_mode: "HTML" });
  }
  return true;
}
