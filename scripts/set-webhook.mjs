#!/usr/bin/env node
/**
 * 一键注册 webhook。
 *
 *   node scripts/set-webhook.mjs --url https://paffbot.example.workers.dev
 *   node scripts/set-webhook.mjs --url https://... --delete
 *   node scripts/set-webhook.mjs --info
 *
 * 读取顺序：命令行 > 环境变量 > .dev.vars
 */

import { execFileSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const args = process.argv.slice(2);

function arg(name, fallback = undefined) {
  const index = args.indexOf(`--${name}`);
  if (index >= 0 && args[index + 1] && !args[index + 1].startsWith("--")) return args[index + 1];
  return fallback;
}

function loadDevVars() {
  const path = resolve(process.cwd(), ".dev.vars");
  const vars = {};
  if (!existsSync(path)) return vars;
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 0) continue;
    vars[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
  }
  return vars;
}

const devVars = loadDevVars();
const token = arg("token") ?? process.env.BOT_TOKEN ?? devVars.BOT_TOKEN;
const secret = arg("secret") ?? process.env.WEBHOOK_SECRET ?? devVars.WEBHOOK_SECRET;
const baseUrl = arg("url") ?? process.env.WEBHOOK_URL;

if (!token) {
  console.error("缺少 BOT_TOKEN（--token / 环境变量 / .dev.vars）");
  process.exit(1);
}

const apiBase = (process.env.TELEGRAM_API_BASE ?? "https://api.telegram.org").replace(/\/+$/, "");
// 大陆网络直连 api.telegram.org 通常不通；设了代理变量就走 curl -x。
const proxy =
  process.env.HTTPS_PROXY || process.env.https_proxy || process.env.ALL_PROXY || process.env.all_proxy || "";

async function call(method, payload = {}) {
  const url = `${apiBase}/bot${token}/${method}`;
  let body;

  if (proxy) {
    const out = execFileSync(
      "curl",
      [
        "-sS",
        "-m",
        "30",
        "-x",
        proxy,
        "-X",
        "POST",
        "-H",
        "content-type: application/json",
        "--data-binary",
        JSON.stringify(payload),
        url,
      ],
      { encoding: "utf8" },
    );
    body = JSON.parse(out);
    if (!body?.ok) throw new Error(`${method} 失败：${body?.description ?? "未知错误"}`);
    return body.result;
  }

  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  body = await res.json().catch(() => null);
  if (!res.ok || !body?.ok) {
    throw new Error(`${method} 失败：${body?.description ?? res.status}`);
  }
  return body.result;
}

const info = await call("getWebhookInfo").catch((err) => ({ error: err.message }));
const me = await call("getMe").catch(() => null);
if (me) console.log(`bot: @${me.username ?? me.first_name} (${me.id})`);

if (args.includes("--info")) {
  console.log(JSON.stringify(info, null, 2));
  process.exit(0);
}

if (args.includes("--delete")) {
  await call("deleteWebhook", { drop_pending_updates: false });
  console.log("已删除 webhook。");
  process.exit(0);
}

if (!baseUrl || !secret) {
  console.error("缺少 --url 或 WEBHOOK_SECRET。用法：node scripts/set-webhook.mjs --url https://xxx.workers.dev");
  process.exit(1);
}
if (secret.length < 16) {
  console.error("WEBHOOK_SECRET 至少 16 个字符。");
  process.exit(1);
}

const webhookUrl = `${baseUrl.replace(/\/+$/, "")}/tg/${secret}`;
await call("setWebhook", {
  url: webhookUrl,
  secret_token: secret,
  allowed_updates: ["message", "callback_query", "chat_join_request", "chat_member", "my_chat_member"],
  drop_pending_updates: false,
});
console.log(`webhook 已设置：${webhookUrl}`);

await call("setMyCommands", {
  commands: [
    { command: "start", description: "开始 / 继续验证" },
    { command: "help", description: "查看命令帮助" },
    { command: "id", description: "查看当前会话 id" },
    { command: "info", description: "关于芙 Bot" },
  ],
}).catch((err) => console.warn(`setMyCommands 跳过：${err.message}`));

// 管理员命令只对群管理员可见
await call("setMyCommands", {
  scope: { type: "all_chat_administrators" },
  commands: [
    { command: "pass", description: "管理员：放行某个用户" },
    { command: "ban", description: "管理员：封禁某个用户" },
    { command: "pending", description: "管理员：待验证人数" },
    { command: "audit", description: "管理员：最近审计记录" },
    { command: "allowedbots", description: "管理员：本群 bot 白名单" },
    { command: "addallowedbot", description: "管理员：把 bot 加入白名单" },
    { command: "delallowedbot", description: "管理员：从白名单移除 bot" },
  ],
}).catch((err) => console.warn(`setMyCommands(管理员) 跳过：${err.message}`));

const after = await call("getWebhookInfo");
console.log(
  JSON.stringify(
    {
      url: after.url,
      pending_update_count: after.pending_update_count,
      last_error_message: after.last_error_message ?? null,
      allowed_updates: after.allowed_updates ?? null,
    },
    null,
    2,
  ),
);
