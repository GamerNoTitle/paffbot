import type { Config } from "../env";
import { fetchGithubKeys, fetchGithubProfile, isOrgMember } from "../lib/github";
import { verifySshSignature } from "../lib/ssh/sshsig";

/** OpenSSH 默认命名空间是 file；同时兼容我们自己的 paffbot。 */
const NAMESPACES = ["file", "paffbot"] as const;

/** echo / PowerShell 管道都会补换行，几种常见写法都认。 */
export function messageVariants(challenge: string): string[] {
  return [challenge, `${challenge}\n`, `${challenge}\r\n`];
}

export interface GithubOwnershipResult {
  ok: boolean;
  error?: string;
  fingerprint?: string;
  keyType?: string;
  namespace?: string;
}

/**
 * 校验「这个 GitHub 账号的所有者，持有某把私钥」：
 *   1. 拉 github.com/<username>.keys（或 GITHUB_KEYS_BASE 指定的镜像）
 *   2. 用其中任意一把公钥验 SSHSIG
 *   3. 命中的公钥指纹必须在该账号的公钥列表里
 *
 * 群验证和浏览器独立校验共用这段逻辑。
 */
export async function verifyGithubOwnership(
  config: Config,
  username: string,
  signature: string,
  challenge: string,
): Promise<GithubOwnershipResult> {
  let keys;
  try {
    keys = await fetchGithubKeys(username, config.githubToken, config.githubKeysBase);
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

  // 可选门槛：账号年龄 / 组织成员（配置了才走 GitHub API）
  if (config.githubMinAccountAgeDays > 0 || config.githubRequiredOrg) {
    try {
      if (config.githubMinAccountAgeDays > 0) {
        const profile = await fetchGithubProfile(username, config.githubToken);
        const ageDays = (Date.now() - profile.createdAt) / 86_400_000;
        if (ageDays < config.githubMinAccountAgeDays) {
          return { ok: false, error: `GitHub 账号注册不足 ${config.githubMinAccountAgeDays} 天` };
        }
      }
      if (config.githubRequiredOrg) {
        const member = await isOrgMember(username, config.githubRequiredOrg, config.githubToken);
        if (!member) return { ok: false, error: `你的 GitHub 账号不在组织 ${config.githubRequiredOrg} 中` };
      }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : "校验 GitHub 账号信息失败" };
    }
  }

  let lastReason: string | undefined;
  for (const namespace of NAMESPACES) {
    for (const message of messageVariants(challenge)) {
      const result = await verifySshSignature({ armor: signature, message, namespace });
      if (!result.ok) {
        lastReason = result.reason;
        continue;
      }
      if (!result.fingerprint || !supported.some((key) => key.fingerprint === result.fingerprint)) {
        return { ok: false, error: "签名用的公钥不在该 GitHub 账号的公钥列表里" };
      }
      return {
        ok: true,
        fingerprint: result.fingerprint,
        keyType: result.keyType,
        namespace,
      };
    }
  }

  return {
    ok: false,
    error: `签名校验未通过${lastReason ? `：${lastReason}` : "，请确认命令输出被完整粘贴"}`,
  };
}
