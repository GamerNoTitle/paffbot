import { assertPending, type ProviderStart, type ProviderSubmitResult, type VerifyContext, type VerifyProvider } from "../types";

/**
 * 最低保障的"点一下"验证：无法区分人和脚本，但保证部署后立刻能用。
 * 生产环境建议至少启用 ssh 或 quiz。
 */
export const buttonProvider: VerifyProvider = {
  id: "button",
  label: "一键确认",
  description: "点一下确认你是真人（强度最低，建议只在测试或兜底时启用）",

  async start(ctx: VerifyContext): Promise<ProviderStart> {
    assertPending(ctx.verification);
    return { note: "点击下方按钮即完成验证" };
  },

  async submit(ctx: VerifyContext): Promise<ProviderSubmitResult> {
    assertPending(ctx.verification);
    return { ok: true, proof: { method: "button" } };
  },
};
