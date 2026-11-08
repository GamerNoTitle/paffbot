# 部署文档

面向「从零把 PaffBot 跑起来」的人。每一步都可以直接复制执行，命令默认在仓库根目录。

## 0. 前置条件

| 项 | 要求 |
|---|---|
| Node.js | ≥ 20 |
| Cloudflare 账号 | 免费版即可（Workers + D1 + 自定义域名） |
| Telegram Bot | 从 [@BotFather](https://t.me/BotFather) 创建，拿到 token |
| 域名 | 可选；没有就用 `*.workers.dev`，但 Mini App 必须 HTTPS |

```bash
npm install
npx wrangler login
```

## 1. 建数据库

```bash
npx wrangler d1 create paffbot
```

把输出里的 `database_id` 填进 `wrangler.jsonc`：

```jsonc
"d1_databases": [
  {
    "binding": "DB",
    "database_name": "paffbot",
    "database_id": "<这里>",
    "migrations_dir": "migrations"
  }
]
```

## 2. 建表

```bash
npx wrangler d1 migrations apply DB --remote
```

本地开发用 `--local`（见第 6 节）。

## 3. 写密钥

这几项**只能**通过 secret 提供，不写进仓库：

```bash
npx wrangler secret put BOT_TOKEN        # BotFather 给的 token
npx wrangler secret put WEBHOOK_SECRET   # 自己生成，至少 16 位，同时是 URL 路径段
npx wrangler secret put ADMIN_IDS        # 你的 Telegram 数字 id（救急用，可留空）
```

生成随机串：

```bash
openssl rand -hex 32
```

`WEBHOOK_SECRET` 推荐 32 字节随机值：它既是 webhook 路径的一部分，也是
`X-Telegram-Bot-Api-Secret-Token` 头，两处必须一致，脚本会自动处理。

可选：

```bash
npx wrangler secret put SETTINGS_KEY     # 配置加密的根密钥；不填则用 BOT_TOKEN 派生
```

## 4. 部署

```bash
npm run deploy          # = build:ui（打包 Material 组件）+ wrangler deploy
```

首次部署后确认服务活着：

```bash
curl https://<你的域名>/health
# {"ok":true,"service":"paffbot","database":true,...}
```

## 5. 注册 webhook 和命令菜单

```bash
npm run webhook -- --url https://<你的域名>
```

脚本会做三件事：设 webhook（路径 `<域名>/tg/<WEBHOOK_SECRET>`）、注册默认命令菜单、
把管理员命令挂在 `all_chat_administrators` 作用域。**设完会回读校验**，URL 不符直接非零退出。

国内网络需要代理：

```bash
HTTPS_PROXY=http://127.0.0.1:10809 npm run webhook -- --url https://<你的域名>
```

## 6. 本地开发

```bash
cp .dev.vars.example .dev.vars     # 填 BOT_TOKEN / WEBHOOK_SECRET
npx wrangler d1 migrations apply DB --local
npm run dev                        # 同时打包 UI，起本地 Worker
```

本地想收真实 Telegram 更新，需要把本地端口暴露出去（如 `cloudflared tunnel`），
再把 webhook 指过去。

## 7. 日常更新

```bash
git pull
npm ci
npx wrangler d1 migrations apply DB --remote   # 有新迁移才需要
npm run deploy
```

只改了代码、没有新迁移时，最后一步就够了。

## 8. 回滚

```bash
npx wrangler rollback          # 回到上一个版本
npx wrangler deployments list  # 看历史版本
```

数据库迁移**不可逆**。改表结构前先导一份：

```bash
npx wrangler d1 export DB --remote --output backup.sql
```

## 9. 改配置的三种方式

从这一版开始，绝大部分配置都在数据库里，**不需要重新部署**：

| 改什么 | 怎么改 |
|---|---|
| 业务配置（TTL、限额、关键词、GitHub 门槛、人机验证、bot 白名单） | 小程序顶部「设置」tab（仅超管可见），保存即生效 |
| `MINI_APP_URL`、`ADMIN_IDS` | 同上；数据库里的 `ADMIN_IDS` 是唯一来源，Worker secret 里那份只在首次初始化时参考 |
| `BOT_TOKEN`、`WEBHOOK_SECRET`、`SETTINGS_KEY` | `npx wrangler secret put <名字>`，立即生效 |
| 测试钩子（`TELEGRAM_API_BASE`、`GITHUB_KEYS_BASE`、`TURNSTILE_VERIFY_URL`） | `wrangler.jsonc` 的 vars + `npm run deploy` |

配置优先级：**数据库 > Worker env > 代码默认值**。数据库里的空值表示回退上一级。

## 10. 第一次进设置页

1. 用超管账号私聊机器人，发 `/start`
2. 点消息里的按钮打开 Mini App
3. 顶部会出现第三个 tab「设置」
4. 先确认 `ADMIN_IDS` 至少有一个你的 id，再改别的

如果看不到「设置」tab：说明当前账号不是超管，检查 `npx wrangler secret list` 里
`ADMIN_IDS` 是否包含你的数字 id。

## 11. 常见问题

| 现象 | 原因 | 处理 |
|---|---|---|
| 所有命令没反应 | webhook URL 拼错（常见是多写了一层 `/tg`） | `npx wrangler secret put` 不变，重跑 `npm run webhook -- --url https://<域名>`；脚本会回读校验 |
| 命令没反应且 `getWebhookInfo` 里 `last_error_message` 是 404 | 同上 | 同上 |
| 进不了设置页 / 没有「设置」tab | 不是超管 | 数据库 `settings` 里的 `ADMIN_IDS` 是唯一来源；确认里面有你的 id |
| 密钥类配置突然变空 | 轮换过 `BOT_TOKEN` 且没配 `SETTINGS_KEY` | 重新在设置页填一次，或补一个固定的 `SETTINGS_KEY` |
| Mini App 打不开 | 域名不是 HTTPS，或 webhook 域名与 Mini App 域名不一致 | 统一用同一个 HTTPS 域名，必要时填 `MINI_APP_URL` |
| 人机验证组件不显示 | `CAPTCHA_ENABLED` 没开，或选了 `cap` 却没填 `CAPTCHA_CAPJS_URL` | 设置页补齐，保存后刷新小程序 |
| 群里的验证消息不自动改文案 | 机器人缺少删除/编辑消息权限 | 给 bot 群管理员权限，至少勾「删除消息」「封禁用户」 |

## 12. 权限清单

机器人需要成为**群管理员**，勾选：

- 删除消息（拦截广告、改文案后清理）
- 封禁用户（拒绝、超时移出、bot 拦截）
- 邀请用户（申请模式放行需要）

「入群申请」模式下还需要在群设置里开启「管理员批准入群」。
