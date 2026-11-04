import type { Config } from "../env";
import type { VerificationRow } from "../db";
import type { TgUser } from "../lib/telegram";

export interface VerifyContext {
  config: Config;
  db: D1Database;
  verification: VerificationRow;
  user: TgUser;
}

export interface PublicQuestion {
  id: string;
  question: string;
  options: string[];
}

export interface PublicSshKey {
  fingerprint: string;
  keyType: string;
  label: string | null;
  createdAt: number;
}

export interface ProviderStart {
  challenge?: string;
  questions?: PublicQuestion[];
  keys?: PublicSshKey[];
  note?: string;
  /** 给前端的额外门槛提示（如 GitHub 账号年龄、组织要求） */
  requirements?: Record<string, unknown>;
}

export type ProviderSubmitResult = { ok: true; proof?: Record<string, unknown> } | { ok: false; error: string };

/**
 * 验证方式插件接口。加一种新方式 = 新增一个实现 + 在 registry 里注册，
 * 状态机、审计、超时、放行逻辑都不用改。
 */
export interface VerifyProvider {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  start(ctx: VerifyContext): Promise<ProviderStart>;
  submit(ctx: VerifyContext, body: Record<string, unknown>): Promise<ProviderSubmitResult>;
}

/** SSHSIG 签名用的 namespace，用户侧 `-n` 参数必须与之一致。 */
export const SIGN_NAMESPACE = "paffbot";

export function challengeFor(verification: Pick<VerificationRow, "id" | "nonce">): string {
  return `paffbot-verify:v1:${verification.id}:${verification.nonce}`;
}

export function assertPending(verification: VerificationRow): void {
  if (verification.status !== "pending") throw new Error("这条验证已经结束，请重新发起");
  if (verification.expires_at <= Date.now()) throw new Error("验证已超时，请重新发起");
}
