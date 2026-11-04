import { githubProvider } from "./providers/github";
import type { VerifyProvider } from "./types";

/**
 * 当前只提供 GitHub SSH 验证。以后要加新方式：
 *   1. 实现 VerifyProvider
 *   2. 加进 ALL
 *   3. 前端 renderMethodSwitch / selectMethod 里补一条分支
 */
const ALL: VerifyProvider[] = [githubProvider];

export interface ProviderRegistry {
  get(id: string): VerifyProvider | undefined;
  list(): VerifyProvider[];
}

export function createProviderRegistry(): ProviderRegistry {
  return {
    get: (id) => ALL.find((p) => p.id === id),
    list: () => ALL,
  };
}
