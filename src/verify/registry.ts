import type { Config } from "../env";
import { captchaProvider } from "./providers/captcha";
import { githubProvider } from "./providers/github";
import type { VerifyProvider } from "./types";

/**
 * 当前只提供 GitHub SSH 验证。以后要加新方式：
 *   1. 实现 VerifyProvider
 *   2. 加进 ALL
 *   3. 前端 renderMethodSwitch / selectMethod 里补一条分支
 */
function buildAll(config?: Config): VerifyProvider[] {
  const all: VerifyProvider[] = [githubProvider];
  if (config?.captchaEnabled && config.captchaProvider) all.push(captchaProvider);
  return all;
}

export interface ProviderRegistry {
  get(id: string): VerifyProvider | undefined;
  list(): VerifyProvider[];
}

export function createProviderRegistry(config?: Config): ProviderRegistry {
  const all = buildAll(config);
  return {
    get: (id) => all.find((p) => p.id === id),
    list: () => all,
  };
}
