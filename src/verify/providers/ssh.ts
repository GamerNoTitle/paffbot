import { listSshKeys, touchSshKey } from "../../db";
import { verifySshSignature } from "../../lib/ssh/sshsig";
import {
  assertPending,
  challengeFor,
  SIGN_NAMESPACE,
  type ProviderStart,
  type ProviderSubmitResult,
  type VerifyContext,
  type VerifyProvider,
} from "../types";

/**
 * SSH 公钥签名验证。
 *
 * 用户侧一次性动作：
 *   echo "<challenge>" > msg.txt
 *   ssh-keygen -Y sign -n paffbot -f ~/.ssh/id_ed25519 msg.txt
 *   cat msg.txt.sig
 * 把 .sig 内容贴回 Mini App。
 *
 * 服务端只认"用该用户注册过的公钥、对本次一次性挑战串、命名空间 paffbot"的有效签名，
 * 因此客户端无法自证通过，也无法重放到另一次验证。
 */
export const sshProvider: VerifyProvider = {
  id: "ssh",
  label: "SSH 公钥签名",
  description: "用你本机的 SSH 私钥签一段一次性挑战串，证明你是这个身份的持有者",

  async start(ctx: VerifyContext): Promise<ProviderStart> {
    assertPending(ctx.verification);
    const keys = await listSshKeys(ctx.db, ctx.verification.user_id);
    return {
      challenge: challengeFor(ctx.verification),
      keys: keys.map((k) => ({
        fingerprint: k.fingerprint,
        keyType: k.key_type,
        label: k.label,
        createdAt: k.created_at,
      })),
      note: keys.length === 0 ? "还没有登记公钥，请先在下方粘贴你的公钥" : "用已登记的公钥对挑战串签名",
    };
  },

  async submit(ctx: VerifyContext, body: Record<string, unknown>): Promise<ProviderSubmitResult> {
    assertPending(ctx.verification);

    const signature = typeof body.signature === "string" ? body.signature.trim() : "";
    if (!signature) return { ok: false, error: "缺少签名内容" };
    if (signature.length > 20_000) return { ok: false, error: "签名内容过长" };

    const keys = await listSshKeys(ctx.db, ctx.verification.user_id);
    if (keys.length === 0) return { ok: false, error: "还没有登记任何公钥" };

    const challenge = challengeFor(ctx.verification);
    // 宽容一点：用户用 `echo > msg.txt` 会多一个换行，也认。
    let result = await verifySshSignature({ armor: signature, message: challenge, namespace: SIGN_NAMESPACE });
    if (!result.ok) {
      result = await verifySshSignature({
        armor: signature,
        message: `${challenge}\n`,
        namespace: SIGN_NAMESPACE,
      });
    }

    if (!result.ok) {
      return { ok: false, error: `签名无效：${result.reason ?? "校验失败"}` };
    }

    const matched = keys.find((k) => k.fingerprint === result.fingerprint);
    if (!matched) {
      return {
        ok: false,
        error: `这把公钥（${result.fingerprint}）不属于当前账号，请先用 /keys 登记`,
      };
    }

    await touchSshKey(ctx.db, matched.id);
    return {
      ok: true,
      proof: { fingerprint: result.fingerprint, keyType: result.keyType, hashAlgorithm: result.hashAlgorithm },
    };
  },
};
