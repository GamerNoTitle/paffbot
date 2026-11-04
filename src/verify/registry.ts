import type { Config } from "../env";
import { buttonProvider } from "./providers/button";
import { githubProvider } from "./providers/github";
import { quizProvider } from "./providers/quiz";
import { sshProvider } from "./providers/ssh";
import type { VerifyProvider } from "./types";

const ALL: VerifyProvider[] = [githubProvider, sshProvider, quizProvider, buttonProvider];

export interface ProviderRegistry {
  get(id: string): VerifyProvider | undefined;
  list(): VerifyProvider[];
  has(id: string): boolean;
}

export function createProviderRegistry(config: Config): ProviderRegistry {
  const enabled: VerifyProvider[] = [];
  for (const id of config.methods) {
    const provider = ALL.find((p) => p.id === id);
    if (!provider) {
      console.warn(`[verify] 忽略未知验证方式: ${id}`);
      continue;
    }
    if (!enabled.includes(provider)) enabled.push(provider);
  }
  // 全配错也要能跑起来，否则部署完就是一台死机器。
  if (enabled.length === 0) enabled.push(buttonProvider);

  return {
    get: (id) => enabled.find((p) => p.id === id),
    list: () => enabled,
    has: (id) => enabled.some((p) => p.id === id),
  };
}
