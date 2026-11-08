# 变量文档

配置分三层，读取顺序：**数据库 `settings` 表 → Worker env/secret → 代码默认值**。
数据库里的空值等于「没配」，会回退到下一层。

- 需要 `wrangler secret put` 的：`BOT_TOKEN`、`WEBHOOK_SECRET`、`SETTINGS_KEY`、`ADMIN_IDS`（救急用）
- 能在小程序「设置」页改的：下面 B、C 两组
- 只在 `wrangler.jsonc` 里的：D 组（工程用，不建议暴露到界面）

---

## A. 密钥（Worker secret）

| 变量 | 必填 | 说明 |
|---|---|---|
| `BOT_TOKEN` | ✅ | BotFather 给的 token。缺失时启动直接报错 |
| `WEBHOOK_SECRET` | ✅ | 同时是 webhook 路径段和 `secret_token`，≥16 字符，建议 32 字节随机 |
| `SETTINGS_KEY` | 可选 | 配置加密的根密钥。不填则用 `BOT_TOKEN` 派生；换掉它会让已加密的配置失效 |
| `ADMIN_IDS` | 可选 | 只在**数据库还没有 `ADMIN_IDS` 时**用于首次初始化。数据库一旦有值，这一项完全不生效 |

## B. 基础（数据库 + 设置页）

| 变量 | 默认 | 校验 | 说明 |
|---|---|---|---|
| `ADMIN_IDS` | 空 | 至少 1 个 | 超级管理员。可跨群操作、看全量审计、改配置。**前后端都强制至少留一个**，所以不会出现无人可管的情况 |
| `MINI_APP_URL` | 自动推导 | `http(s)://` 前缀 | Mini App 地址。留空时用 webhook 请求的 origin |
| `ALLOWED_BOTS` | 空 | 纯数字 id | 全局放行的 bot。不在名单、也不是群管理员的 bot，发言会被删除并封禁 |

## C1. 验证（数据库 + 设置页）

| 变量 | 默认 | 范围 | 说明 |
|---|---|---|---|
| `VERIFY_TTL_SECONDS` | 300 | 60–86400 | 验证有效期（秒）。申请模式受 Telegram 5 分钟私聊窗口限制，不建议调高 |
| `VERIFY_DAILY_LIMIT` | 3 | 1–50 | 每个账号在**每个群**每天的验证次数，按 UTC+8 自然日重置 |
| `AUDIT_RETENTION_DAYS` | 365 | 1–3650 | 审计记录保留天数 |
| `SCREEN_KEYWORDS` | 内置词表 | 逗号分隔 | 广告关键词。留空用代码内置的中英文词表 |

## C2. GitHub（数据库 + 设置页）

| 变量 | 默认 | 校验 | 说明 |
|---|---|---|---|
| `GITHUB_MIN_ACCOUNT_AGE_DAYS` | 0 | 0–3650 | GitHub 账号最少注册天数，0 表示不限制。需要 `GITHUB_TOKEN` 才能查 |
| `GITHUB_REQUIRED_ORG` | 空 | 文本 | 要求加入的 GitHub 组织，留空不限制 |
| `GITHUB_TOKEN` | 空 | 文本（**加密存储**） | 查询账号年龄/组织用的 PAT，只读即可 |
| `GITHUB_OAUTH_CLIENT_ID` | 空 | 文本 | GitHub OAuth App 的 client id；留空则小程序不显示 OAuth 方式 |
| `GITHUB_OAUTH_SECRET` | 空 | 文本（**加密存储**） | 对应 client secret |
| `GITHUB_OAUTH_REDIRECT` | 自动 | `http(s)://` 前缀 | 回调地址，留空按请求 origin 推导 |

## C3. 人机验证（数据库 + 设置页）

| 变量 | 默认 | 校验 | 说明 |
|---|---|---|---|
| `CAPTCHA_ENABLED` | false | `true`/`false` | 总开关。开启后小程序出现「人机验证」通道 |
| `CAPTCHA_PROVIDER` | 空 | `cap` / `turnstile` | 二选一，**不做推断**。`CAPTCHA_ENABLED=true` 时必须选一种，且该方式的必填项不能为空 |
| `CAPTCHA_URL` | 空 | `http(s)://` 前缀 | 自建 Cap.js 地址，如 `https://cap.example.com` |
| `CAPTCHA_HOLD_HOURS` | 24 | 1–720 | 人机验证通过后保留的时长（小时），期间不会被超时移除，但仍需管理员放行 |
| `TURNSTILE_SITE_KEY` | 空 | 文本 | Cloudflare Turnstile 的 site key（公开值） |
| `TURNSTILE_SECRET` | 空 | 文本（**加密存储**） | Turnstile 的 secret |

> 人机验证通过**不等于**放行：只延长保留时限并在群里发一条带「通过 / 拒绝 / 封禁」的消息。

## D. 工程用（仅 `wrangler.jsonc`，不进设置页）

| 变量 | 默认 | 说明 |
|---|---|---|
| `TELEGRAM_API_BASE` | `https://api.telegram.org` | 指向 mock 服务器，冒烟测试用 |
| `GITHUB_KEYS_BASE` | `https://github.com` | `/<user>.keys` 的基地址，测试用 |
| `TURNSTILE_VERIFY_URL` | Cloudflare 官方 | siteverify 地址，测试用 |
| `ENVIRONMENT` | `production` | 环境标记，仅用于展示 |

---

## 加密说明

`GITHUB_TOKEN`、`GITHUB_OAUTH_SECRET`、`TURNSTILE_SECRET` 存库前用 **AES-256-GCM** 加密：

```
密钥材料 = SETTINGS_KEY || BOT_TOKEN
派生方式 = HKDF-SHA256(salt="paffbot-settings-v1", info="settings-aes-gcm")
存储格式 = base64(12 字节 IV ‖ 密文 ‖ tag)
```

- 页面只显示「已设置」，不回显内容
- 解密失败按空值处理（例如换过 `BOT_TOKEN` 又没配 `SETTINGS_KEY`），此时需要重新填一次
- 要清掉某项：设置页点「清除」，或写入空字符串

## 校验规则

前后端共用同一套规则（后端在 `src/config/settings.ts`，前端在 `public/app.js`）：

| 类型 | 规则 |
|---|---|
| `int` | 纯数字，且落在 min–max |
| `intList` | 逗号/空格分隔的正整数；`ADMIN_IDS` 额外要求至少 1 个 |
| `bool` | `true` / `false` / `1` / `0`，存库归一化成 `true`/`false` |
| `enum` | 必须是给定选项之一 |
| `url` | 必须以 `http://` 或 `https://` 开头 |
| `string` / `csv` | 不校验内容，只做去空格 |

后端拒绝时返回 400 与具体原因；前端先拦一遍，减少往返。

## 配置写入了哪里

- 改动写入 `settings` 表，同时写一条审计 `settings.updated`（只记键名，不记值）
- 进程内 30 秒缓存，写入后立即失效；最长 30 秒后所有实例都看到新值
- 想彻底回到 Worker env：调用 `POST /api/admin/settings/reset`（设置页暂无入口），
  或直接删 `settings` 表里对应的行
