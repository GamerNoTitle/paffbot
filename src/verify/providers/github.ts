import { isValidGithubUsername, normalizeGithubUsername } from "../../lib/github";
import { verifyGithubOwnership } from "../github-verify";
import {
  assertPending,
  challengeFor,
  type ProviderStart,
  type ProviderSubmitResult,
  type VerifyContext,
  type VerifyProvider,
} from "../types";

/**
 * GitHub SSH 验证：
 *   1. 用户输入 GitHub 用户名
 *   2. 用本机私钥对一次性挑战串签名（echo ... | ssh-keygen -Y sign -n file -）
 *   3. 服务端拉 github.com/<用户名>.keys，用其中任意一把公钥验签
 *
 * 不需要 OAuth、不读私有数据；验签逻辑与浏览器独立校验共用。
 */
export const githubProvider: VerifyProvider = {
  id: "github",
  chatCapable: true,
  label: "GitHub SSH",
  description: "用已添加到 GitHub 账号的 SSH 私钥签名，证明你拥有该账号",

  async start(ctx: VerifyContext): Promise<ProviderStart> {
    assertPending(ctx.verification);
    return {
      challenge: challengeFor(ctx.verification),
      note: "命令里的私钥路径要换成你自己的；对应公钥必须已添加到 GitHub 账号",
      requirements: {
        minAccountAgeDays: ctx.config.githubMinAccountAgeDays,
        requiredOrg: ctx.config.githubRequiredOrg,
      },
    };
  },

  async submit(ctx: VerifyContext, body: Record<string, unknown>): Promise<ProviderSubmitResult> {
    assertPending(ctx.verification);

    const username = normalizeGithubUsername(typeof body.username === "string" ? body.username : "");
    const signature = typeof body.signature === "string" ? body.signature.trim() : "";

    if (!username) return { ok: false, error: "请填写 GitHub 用户名" };
    if (!isValidGithubUsername(username)) return { ok: false, error: "GitHub 用户名格式不正确" };
    if (!signature) return { ok: false, error: "请粘贴签名结果" };
    if (signature.length > 20_000) return { ok: false, error: "签名内容过长" };
    if (!signature.includes("BEGIN SSH SIGNATURE")) {
      return { ok: false, error: "看起来不是 SSHSIG 签名（应包含 -----BEGIN SSH SIGNATURE-----）" };
    }

    const result = await verifyGithubOwnership(ctx.config, username, signature, challengeFor(ctx.verification));
    if (!result.ok) return { ok: false, error: result.error ?? "校验失败" };

    return {
      ok: true,
      proof: {
        githubUsername: username,
        fingerprint: result.fingerprint,
        keyType: result.keyType,
        namespace: result.namespace,
      },
    };
  },
};
