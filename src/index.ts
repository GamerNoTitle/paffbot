import { Hono } from "hono";
import { handleUpdate } from "./bot/webhook";
import { runScheduled } from "./cron";
import { constantTimeEqual, utf8 } from "./lib/crypto";
import type { Env } from "./env";
import type { TgUpdate } from "./lib/telegram";
import { buildContext, createApi, type AppBindings } from "./web/api";

const app = new Hono<AppBindings>();

app.get("/health", (c) => c.json({ ok: true, service: "paffbot", time: Date.now() }));

app.get("/api/health", (c) => c.json({ ok: true, service: "paffbot", time: Date.now() }));

/**
 * Telegram webhook。secret 同时出现在路径段和 X-Telegram-Bot-Api-Secret-Token 头里，
 * 两处都校验，避免路径泄露后被人伪造 update。
 */
app.post("/tg/:secret", async (c) => {
  const ctx = buildContext(c.env, new URL(c.req.url).origin);
  const secret = c.req.param("secret") ?? "";
  const header = c.req.header("x-telegram-bot-api-secret-token") ?? "";

  if (
    !constantTimeEqual(utf8(secret), utf8(ctx.config.webhookSecret)) ||
    !constantTimeEqual(utf8(header), utf8(ctx.config.webhookSecret))
  ) {
    return c.text("forbidden", 403);
  }

  let update: TgUpdate;
  try {
    update = await c.req.json<TgUpdate>();
  } catch {
    return c.json({ ok: false, error: "invalid json" }, 400);
  }

  try {
    await handleUpdate(ctx, update);
  } catch (err) {
    // 已按 update_id 去重，这里吞掉异常返回 200，避免 Telegram 无限重投同一条坏数据。
    console.error(`[webhook] update ${update.update_id} 处理失败:`, err instanceof Error ? err.stack : err);
  }
  return c.json({ ok: true });
});

app.route("/", createApi());

// 其余请求交给 Static Assets（Mini App 的 index.html / app.js / style.css）
app.all("*", (c) => c.env.ASSETS.fetch(c.req.raw));

export default {
  fetch: app.fetch,
  async scheduled(_controller: ScheduledController, env: Env, _ctx: ExecutionContext): Promise<void> {
    await runScheduled(env);
  },
} satisfies ExportedHandler<Env>;
