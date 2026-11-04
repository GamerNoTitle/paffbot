import { listExpiredPending, pruneOldVerifications, pruneRateLimits } from "./db";
import { pruneChallenges } from "./lib/challenge";
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
  const config = loadConfig(env);
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

  const now = new Date();
  if (now.getUTCHours() === 3 && now.getUTCMinutes() < 2) {
    const pruned = await pruneOldVerifications(env.DB, config.retentionDays);
    const challenges = await pruneChallenges(env.DB);
    const quotas = await pruneRateLimits(env.DB);
    const chain = await verifyAuditChain(env.DB, 2000);
    console.log(
      `[cron] 清理验证记录 ${pruned} 条、挑战 ${challenges} 条、配额 ${quotas} 条；审计链 ${chain.ok ? "完整" : `在 #${chain.brokenAtId} 断开`}`,
    );
  }
}
