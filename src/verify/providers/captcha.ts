import { parseDetail } from "../../db";
import {
  challengeFor,
  assertPending,
  type ProviderStart,
  type ProviderSubmitResult,
  type VerifyContext,
  type VerifyProvider,
} from "../types";

/**
 * 人机验证，二选一：
 *   - cap：自建 Cap.js，前端 web component 解题，走 /api/captcha/:id/* 代理
 *   - turnstile：Cloudflare Turnstile，前端拿 token，服务端 siteverify
 *
 * 定位：给没有 GitHub 的人一条非签名通道；但人机验证不能自证身份，
 * 所以通过后只延长保留时限，仍然要群管理员点「通过」才放行。
 */
/** 解完题到点按钮之间允许的间隔，超时要求重做。 */
const CAP_SOLVED_TTL_MS = 10 * 60_000;

export const captchaProvider: VerifyProvider = {
  id: "captcha",
  chatCapable: false,
  label: "人机验证",
  description: "不用 GitHub，答一道计算题，然后等管理员放行",

  async start(ctx: VerifyContext): Promise<ProviderStart> {
    assertPending(ctx.verification);

    if (ctx.config.captchaProvider === "turnstile") {
      return {
        challenge: challengeFor(ctx.verification),
        note: "做完验证会自动提交，之后等管理员放行；期间不会被移出",
        requirements: {
          provider: "turnstile",
          siteKey: ctx.config.turnstileSiteKey,
          holdHours: ctx.config.captchaHoldHours,
        },
      };
    }

    return {
      challenge: challengeFor(ctx.verification),
      note: "做完题会自动提交，之后等管理员放行；期间不会被移出",
      requirements: {
        provider: "cap",
        endpoint: `/api/captcha/${ctx.verification.id}/`,
        widget: `${(ctx.config.capjsUrl ?? "").replace(/\/+$/, "")}/cap.min.js`,
        holdHours: ctx.config.captchaHoldHours,
      },
    };
  },

  async submit(ctx: VerifyContext, body: Record<string, unknown>): Promise<ProviderSubmitResult> {
    assertPending(ctx.verification);

    if (ctx.config.captchaProvider === "turnstile") {
      const secret = ctx.config.turnstileSecret;
      if (!secret) return { ok: false, error: "人机验证服务未配置" };

      const token = typeof body.turnstileToken === "string" ? body.turnstileToken : "";
      if (!token) return { ok: false, error: "还没有完成人机验证" };

      let res: Response;
      try {
        res = await fetch(ctx.config.turnstileVerifyUrl, {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ secret, response: token }).toString(),
        });
      } catch {
        return { ok: false, error: "人机验证服务连接失败，请重试" };
      }

      const data = (await res.json().catch(() => null)) as { success?: boolean } | null;
      if (!data?.success) return { ok: false, error: "人机验证未通过" };

      return { ok: true, needsReview: true, proof: { turnstile: true } };
    }

    // cap：必须由代理端点的 redeem 成功写过 cap_solved_at，光传个 true 不认
    const detail = parseDetail(ctx.verification.detail);
    const solvedAt = typeof detail.cap_solved_at === "number" ? detail.cap_solved_at : 0;
    if (!solvedAt) return { ok: false, error: "还没有完成人机验证" };
    if (Date.now() - solvedAt > CAP_SOLVED_TTL_MS) return { ok: false, error: "验证已过期，重新做一次" };
    return { ok: true, needsReview: true, proof: { captcha: true } };
  },
};
