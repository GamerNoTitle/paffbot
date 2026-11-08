import {
  deletePurge,
  listDuePurges,
  listExpiredPending,
  listUndeclinedJoinRequests,
  pruneAdminTickets,
  pruneOldVerifications,
  pruneRateLimits,
} from "./db";
import { pruneChallenges } from "./lib/challenge";
import { declineJoinRequest } from "./verify/finalize";
import { updateVerificationDetail } from "./db";
import { nowMs } from "./lib/time";
import { verifyAuditChain } from "./db/audit";
import { loadConfig, type Env } from "./env";
import { TelegramApi } from "./lib/telegram";
import { rejectVerification } from "./verify/finalize";

/**
 * Cron（每分钟）：
 *   1. 把所有超时的 pending 记录按状态机收尾（申请模式 decline / 入群模式踢出）
 *   2. 每天 03:0x UTC 清一次陈旧验证记录并自检审计哈希链
 *
 * 注意：审计日志不参与清理——它是账本，删了就失去审计意义。
 */
export async function runScheduled(env: Env): Promise<void> {
  const config = await loadConfig(env);
  const tg = new TelegramApi(config.botToken, config.apiBase);

  const expired = await listExpiredPending(env.DB, 50);
  for (const row of expired) {
    await rejectVerification(
      { db: env.DB, tg },
      row,
      {
        status: "timeout",
        method: "timeout",
        reason: "expired",
        actorId: 0,
        actorType: "system",
        notify: true,
      },
    );
  }
  if (expired.length > 0) console.log(`[cron] 处理超时验证 ${expired.length} 条`);

  // 到点的失败消息删掉，避免群里堆积
  const due = await listDuePurges(env.DB, Date.now(), 50);
  for (const item of due) {
    await tg.deleteMessage(item.chat_id, item.message_id);
    await deletePurge(env.DB, item.id);
  }
  if (due.length > 0) console.log(`[cron] 清理过期提示消息 ${due.length} 条`);

  // 结案时撤回失败的入群申请：每 5 分钟补一次，成功后打标记，不再重复
  const now = new Date();
  if (now.getUTCMinutes() % 5 === 0) {
    const undeclined = await listUndeclinedJoinRequests(env.DB, nowMs() - 24 * 3600 * 1000, 10);
    for (const row of undeclined) {
      const result = await declineJoinRequest({ db: env.DB, tg }, row.chat_id, row.user_id);
      if (result !== "failed") {
        await updateVerificationDetail(env.DB, row.id, { join_declined: true });
      }
    }
    if (undeclined.length > 0) console.log(`[cron] 补撤回入群申请 ${undeclined.length} 条`);
  }


  if (now.getUTCHours() === 3 && now.getUTCMinutes() < 2) {
    const pruned = await pruneOldVerifications(env.DB, config.retentionDays);
    await pruneAdminTickets(env.DB);
    const challenges = await pruneChallenges(env.DB);
    const quotas = await pruneRateLimits(env.DB);
    const chain = await verifyAuditChain(env.DB, 2000);
    console.log(
      `[cron] 清理验证记录 ${pruned} 条、挑战 ${challenges} 条、配额 ${quotas} 条；审计链 ${chain.ok ? "完整" : `在 #${chain.brokenAtId} 断开`}`,
    );
  }
}
