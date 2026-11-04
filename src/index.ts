import { Hono } from "hono";
import { handleUpdate } from "./bot/webhook";
import { runScheduled } from "./cron";
import { constantTimeEqual, utf8 } from "./lib/crypto";
import type { Env } from "./env";
import type { TgUpdate } from "./lib/telegram";
import { buildContext, createApi, type AppBindings } from "./web/api";

const app = new Hono<AppBindings>();

async function health(db: D1Database) {
  let database = false;
  try {
    const row = await db.prepare("SELECT 1 AS ok").first<{ ok: number }>();
    database = row?.ok === 1;
  } catch (err) {
    console.error("[health] D1 探活失败:", err instanceof Error ? err.message : err);
  }
  return { ok: true, service: "paffbot", database, time: Date.now() };
}

app.get("/health", async (c) => c.json(await health(c.env.DB)));

app.get("/api/health", async (c) => c.json(await health(c.env.DB)));

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
// /admin 直接给同一份 SPA，前端按路径打开审计视图
app.get("/admin", (c) => {
  const url = new URL(c.req.url);
  url.pathname = "/";
  return c.env.ASSETS.fetch(new Request(url.toString(), c.req.raw));
});

app.all("*", (c) => c.env.ASSETS.fetch(c.req.raw));

export default {
  fetch: app.fetch,
  async scheduled(_controller: ScheduledController, env: Env, _ctx: ExecutionContext): Promise<void> {
    // 密钥还没配好时不要让 cron 每分钟抛一次未捕获异常
    try {
      await runScheduled(env);
    } catch (err) {
      console.error("[cron] 执行失败:", err instanceof Error ? err.message : err);
    }
  },
} satisfies ExportedHandler<Env>;
