import type { Config, Env } from "../env";
import type { ProviderRegistry } from "../verify/registry";
import type { TelegramApi } from "../lib/telegram";

export interface BotContext {
  env: Env;
  config: Config;
  db: D1Database;
  tg: TelegramApi;
  providers: ProviderRegistry;
  /** 当前 webhook 请求的 origin，用于在没配 MINI_APP_URL 时推导 Mini App 地址 */
  origin: string;
}

export function miniAppUrl(ctx: BotContext): string {
  if (ctx.config.miniAppUrl) return ctx.config.miniAppUrl.replace(/\/+$/, "");
  return ctx.origin.replace(/\/+$/, "");
}
