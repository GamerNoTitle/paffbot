import { fetchGithubKeys, fetchGithubProfile, isOrgMember, isValidGithubUsername, normalizeGithubUsername } from "../../lib/github";
import { verifySshSignature } from "../../lib/ssh/sshsig";
import {
  assertPending,
  challengeFor,
  type ProviderStart,
  type ProviderSubmitResult,
  type VerifyContext,
  type VerifyProvider,
} from "../types";

/**
 * GitHub SSH 验证（和 verify.yumeyuka.moe 同一套思路，但校验放在服务端）：
 *
 *   1. 用户输入 GitHub 用户名
 *   2. 用本机私钥对一次性挑战串签名：
 *        echo "<challenge>" | ssh-keygen -Y sign -f ~/.ssh/id_ed25519 -n file -
 *   3. 服务端拉 github.com/<用户名>.keys，用其中任意一把公钥验签
 *   4. 验签通过 = 你持有该账号公开公钥对应的私钥，且该公钥确实在该账号下
 *
 * 不需要 OAuth、不需要任何 GitHub 授权、不读私有数据。
 */

/** OpenSSH 默认命名空间是 file；同时兼容我们自己的 paffbot。 */
const NAMESPACES = ["file", "paffbot"] as const;

/** echo / PowerShell 管道都会补换行，几种常见写法都认。 */
function messageVariants(challenge: string): string[] {
  return [challenge, `${challenge}\n`, `${challenge}\r\n`];
}

export const githubProvider: VerifyProvider = {
  id: "github",
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

    let keys;
    try {
      keys = await fetchGithubKeys(username, ctx.config.githubToken);
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : "读取 GitHub 公钥失败" };
    }

    if (keys.length === 0) return { ok: false, error: `GitHub 账号 ${username} 没有公开的 SSH 公钥` };
    const supported = keys.filter((key) => key.supported);
    if (supported.length === 0) {
      return {
        ok: false,
        error: "该账号只有硬件密钥（sk-*），浏览器内无法校验；请改用 ed25519 / RSA / ECDSA 公钥",
      };
    }

    // 可选门槛：账号年龄 / 组织成员（配置了才走 GitHub API，默认零 API 调用）
    if (ctx.config.githubMinAccountAgeDays > 0 || ctx.config.githubRequiredOrg) {
      try {
        if (ctx.config.githubMinAccountAgeDays > 0) {
          const profile = await fetchGithubProfile(username, ctx.config.githubToken);
          const ageDays = (Date.now() - profile.createdAt) / 86_400_000;
          if (ageDays < ctx.config.githubMinAccountAgeDays) {
            return { ok: false, error: `GitHub 账号注册不足 ${ctx.config.githubMinAccountAgeDays} 天` };
          }
        }
        if (ctx.config.githubRequiredOrg) {
          const member = await isOrgMember(username, ctx.config.githubRequiredOrg, ctx.config.githubToken);
          if (!member) return { ok: false, error: `你的 GitHub 账号不在组织 ${ctx.config.githubRequiredOrg} 中` };
        }
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : "校验 GitHub 账号信息失败" };
      }
    }

    const challenge = challengeFor(ctx.verification);
    let lastReason: string | undefined;

    for (const namespace of NAMESPACES) {
      for (const message of messageVariants(challenge)) {
        const result = await verifySshSignature({ armor: signature, message, namespace });
        if (!result.ok) {
          lastReason = result.reason;
          continue;
        }
        if (!result.fingerprint || !supported.some((key) => key.fingerprint === result.fingerprint)) {
          return {
            ok: false,
            error: "签名用的公钥不在该 GitHub 账号的公钥列表里",
          };
        }
        return {
          ok: true,
          proof: {
            githubUsername: username,
            fingerprint: result.fingerprint,
            keyType: result.keyType,
            namespace,
          },
        };
      }
    }

    return {
      ok: false,
      error: `签名校验未通过${lastReason ? `：${lastReason}` : "，请确认命令输出被完整粘贴"}`,
    };
  },
};
