# paffbot

Telegram 群组「入群验证 / 自动放行」机器人。纯 TypeScript 跑在 **Cloudflare Workers + D1** 上，无容器、无长轮询、无常驻进程。

它是 [YumeBot](https://github.com/YumeYuka/YumeBot) 思路的重写版：原版是 C++26 单文件原生可执行程序（libcurl + 无限长轮询 + 全内存状态），无法直接部署到 Workers/Vercel；本仓库保留「入群申请 → 验证 → 放行」的交互，补上了原版没有的持久化、审计、多群支持和可扩展验证方式。

## 特性

- **两种入群模式**：Telegram「入群申请」审核，或直接入群后先禁言再验证。
- **验证方式**：GitHub SSH —— 用 GitHub 账号上已公开的公钥验签，不需要 OAuth；Provider 接口保留，后续可扩展别的验证方式。
- **一次性挑战 + 每日限流**：浏览器校验的挑战 nonce 落库、校验即消费，重放直接失效；同一账号在同一群每天 3 次验证机会（换群重新计），用完后提示明天再来。
- **服务端判定，不信客户端**：Mini App 用 Telegram `initData` 验签识别用户；GitHub 验证由 Worker 拉 `github.com/<user>.keys` 并验 SSHSIG；放行动作由服务端直接调用 Telegram，不依赖前端 `sendData` 自证。
- **Material 3 界面**：官方 [Material Web](https://github.com/material-components/material-web) 组件（tabs / filter chip / outlined text field / filled button / radio…），
  MD3 动态配色（种子色 → 完整 tonal palette，支持明暗主题、跟随 Telegram 主题色），自托管打包，不依赖 CDN。
- **审计闭环**：每次申请、放行、拒绝、超时、手动操作都落库，附 `operator_id`，并维护 SHA-256 哈希链，改库可被发现；Mini App 内可查、可导出 CSV。
- **env 部署**：`wrangler.jsonc` 的 vars + secrets，三条命令上线；`scripts/set-webhook.mjs` 自动注册 webhook 与命令菜单。
- **管理员模型**：`ADMIN_IDS` 超管 + Telegram 实时群管理员（`can_restrict_members`，缓存 60s），权限跟着群设置走。
- **幂等**：webhook 按 `update_id` 去重；状态迁移用 CAS（`WHERE status='pending'`），重复投递不会重复放行。

## 架构

```
                 ┌───────────────────────────────────────────────┐
Telegram ──POST─▶│ Worker (Hono)                                  │
  webhook        │  /tg/:secret          校验 secret_token        │
                 │  /api/session         Mini App 会话            │
                 │  /api/verify/*        验证（start / submit）    │
                 │  /api/audit/*         审计查询 / CSV           │
                 │  /  (Static Assets)   Mini App 前端            │
                 └───────────────┬───────────────────────────────┘
                                 │ D1 binding（SQL）
                          ┌──────▼──────┐
                          │  D1 (SQLite)│
                          │verifications│
                          │ audit_log   │
                          │ ssh_keys    │
                          └─────────────┘
Cron（每分钟）→ 扫过期 pending → 按状态机收尾
```

状态机：

```
join_request ─┐
              ├─▶ pending ──验证通过──▶ approved（approve join / 解除禁言）
group_join ───┘      │
                     ├─ 超时 ────────▶ timeout（decline / ban+unban）
                     ├─ 管理员 /ban ─▶ banned
                     └─ 关键词拦截 ──▶ blocked
```

## 快速开始

前置：Node 20+、Cloudflare 账号、一个 BotFather 建好的 bot。

```bash
npm install

# 1. 建库，把输出的 database_id 填进 wrangler.jsonc
npx wrangler d1 create paffbot

# 2. 写密钥（敏感值不要进 git）
npx wrangler secret put BOT_TOKEN
npx wrangler secret put WEBHOOK_SECRET     # 至少 16 字符，同时作为 URL 路径段

# 3. 建表
npm run db:remote

# 4. 部署
npm run deploy

# 5. 注册 webhook
npm run webhook -- --url https://verify.bili33.top
```

Telegram 侧还要做三件事（漏了会白干）：

1. BotFather：拿 token；Mini App 不需要单独注册域名，但必须是 HTTPS。
2. 群里开启「Approve new members」（申请模式），或接受直接入群 + 立即禁言模式。
3. 把 bot 设为群管理员，至少勾选 **Invite Users**（批准申请）、**Restrict Members**（禁言/踢人）、**Delete Messages**（清理提示）。

## 配置项

| 变量 | 必填 | 说明 |
|---|---|---|
| `BOT_TOKEN` | ✅ | BotFather token（secret） |
| `WEBHOOK_SECRET` | ✅ | 同时用作路径段和 `secret_token`，≥16 字符（secret） |
| `ADMIN_IDS` | ⭕ | 超管 Telegram user id，逗号分隔；可跨群操作、看全量审计 |
| `ADMIN_TOKEN` | ⭕ | 浏览器直接访问审计 API 的 Bearer token（secret） |
| `VERIFY_TTL_SECONDS` | ⭕ | 验证有效期，默认 300（与 Telegram 入群申请私聊窗口一致） |
| `VERIFY_DAILY_LIMIT` | ⭕ | 每个群内每个账号 / 每个 IP 每天可发起的验证次数，默认 3 |
| `MINI_APP_URL` | ⭕ | Mini App 绝对地址；不填则用 webhook 请求的 origin |
| `TELEGRAM_API_BASE` | ⭕ | 自定义 Bot API 地址（本地 mock / 自建网关用） |
| `GITHUB_TOKEN` | ⭕ | 只在启用下面两个门槛时才需要（`api.github.com` 未鉴权 60 次/小时） |
| `GITHUB_MIN_ACCOUNT_AGE_DAYS` | ⭕ | GitHub 账号最小年龄，默认 0（关闭） |
| `GITHUB_REQUIRED_ORG` | ⭕ | 要求属于某个 GitHub 组织（按公开组织成员判断） |
| `SCREEN_KEYWORDS` | ⭕ | 覆盖默认拦截关键词，逗号分隔 |
| `AUDIT_RETENTION_DAYS` | ⭕ | 已结案验证记录保留天数，默认 365（审计日志不清理） |

## 验证方式

### GitHub SSH（默认，推荐）

和 `verify.yumeyuka.moe` 同一套思路，但校验放在服务端，**不需要 OAuth、不需要任何 GitHub 授权**：

```
1. 用户填 GitHub 用户名
2. 本机执行：echo "<挑战串>" | ssh-keygen -Y sign -f ~/.ssh/id_ed25519 -n file -
3. Worker 拉 github.com/<用户名>.keys，用其中任意一把公钥验签
4. 指纹对得上 → 放行
```

证明的两件事：**签名的私钥在你手上**，且**对应公钥确实挂在这个 GitHub 账号下**（能往账号里加公钥的人 = 账号持有者）。

- 只读 `github.com/<user>.keys`（纯文本，不需要鉴权，不受 API 限流）
- 支持 ed25519 / RSA（rsa-sha2-256/512）/ ECDSA p256·384·521；`sk-*` 硬件密钥浏览器内无法校验，会提示换普通密钥
- 签名既接受 `echo` 产生的尾随换行，也接受无换行；命名空间 `file` 与 `paffbot` 都认

### 后续扩展

`src/verify/providers/github.ts` 实现了 `VerifyProvider` 接口（`start` + `submit`）。
要加新的验证方式：实现接口 → 在 `src/verify/registry.ts` 的 `ALL` 里注册 → 前端
`loadPanel` 里按 id 选择面板。

## 管理员与命令

| 角色 | 判定 | 权限 |
|---|---|---|
| 超管 | `ADMIN_IDS` | 跨群 `/pass` `/ban`、全量审计、删他人公钥 |
| 群管理员 | `getChatMember` 且 `can_restrict_members` | 本群 `/pass` `/ban` `/pending` `/audit` |

| 命令 | 说明 |
|---|---|
| `/start` | 私聊：继续未完成的验证 / 查看帮助 |
| `/id` | 当前群 id、自己的 id |
| `/pass [uid]` | 放行（也可回复对方消息） |
| `/ban [uid]` | 封禁并移出 |
| `/pending` | 当前群待验证人数 |
| `/audit [n]` | 最近 n 条审计 |
| `/selftest` | 超管：生成一条自测验证并私聊发入口（不改群成员，用于验证全链路） |

## 审计

- `verifications`：一条记录 = 一次「某人想进某个群」的完整生命周期，含来源、方式、结果、原因、操作者。
- `audit_log`：append-only，每条带 `prev_hash` / `hash`，`/api/audit/overview` 会返回哈希链自检结果，页面显示「哈希链完整 / 在 #id 断开」。
- 导出：Mini App 审计页「导出 CSV」，或 `GET /api/audit/export.csv?chatId=...`（带 `Authorization: Bearer $ADMIN_TOKEN` 或 `X-Telegram-Init-Data`）。
- 时间统一 epoch 毫秒；`AUDIT_RETENTION_DAYS` 只清理已结案的验证记录，**不清理审计日志**（删了就没有审计意义）。

## 安全设计

- Telegram `initData` 按官方算法验签（`HMAC(HMAC("WebAppData", bot_token), data_check_string)`），`auth_date` 限 1 小时；用户身份只取验签后的 `user.id`。
- 放行只能由服务端发起：验证通过后 Worker 直接调 `approveChatJoinRequest` / 解除禁言，前端伪造 `sendData` 没有意义。
- webhook 双重校验：URL 路径段 + `X-Telegram-Bot-Api-Secret-Token`，常数时间比较。
- `update_id` 幂等表 + 状态 CAS，避免重投导致重复放行。
- 浏览器校验的挑战 nonce 存库并原子消费，重放无效；每个账号/IP 每天 3 次（`VERIFY_DAILY_LIMIT`）。
- SSH 挑战串一次性、带命名空间；公钥与 Telegram 账号绑定；单账号最多 5 把。
- 审计记录带 operator，超时/自动拦截记 `system`。

## 已知限制

1. **直接入群模式需要用户先私聊 bot**。Telegram 不允许 bot 主动私聊没和它说过话的人；只有「入群申请」场景有 5 分钟主动私聊窗口。群里那条提示会引导用户发 `/start`。
2. **`VERIFY_TTL_SECONDS` 不要明显超过 300**（申请模式的私聊窗口是 5 分钟），除非你只用直接入群模式。
3. **`button` 方式无法区分人和脚本**，生产建议至少启用 `github`。
4. GitHub 验证依赖账号里已添加的 SSH 公钥；只挂 `sk-*` 硬件密钥的账号在浏览器内校验不了。
5. 审计哈希链是「单写者」假设：D1 本身单库串行写，够用；若改多写者架构需要换成链式锁或外部账本。
6. Mini App 必须在 HTTPS 下打开（Telegram 要求），本地联调需要隧道（如 `cloudflared tunnel`）。
7. 数据库是 D1（SQLite 方言）。SQL 刻意写得比较保守，迁 TiDB 需要改驱动与少量方言（见下）。

## 迁到 TiDB 的路径

数据层集中在 `src/db/*.ts`，SQL 只用标准 CRUD + `INSERT ... ON CONFLICT`。迁 TiDB 时：

1. 把 `D1Database` 换成 TiDB Cloud Serverless 的 HTTP driver 或 Hyperdrive + `mysql2`，保持 `prepare/bind/first/all/run` 形状。
2. `AUTOINCREMENT` → `AUTO_RANDOM`，`ON CONFLICT` → `ON DUPLICATE KEY UPDATE`，布尔/时间字段保持 `BIGINT`。
3. schema 见 `migrations/0001_init.sql`，字段与索引可直接对应。

## 目录结构

```
src/
  index.ts            Worker 入口（webhook / API / assets / scheduled）
  cron.ts             超时收尾与清理
  env.ts              配置加载与默认值
  db/                 D1 查询、审计哈希链
  lib/                Telegram 客户端、SSH 线格式与 SSHSIG、加密、筛查
  verify/             Provider 接口、ssh/quiz/button、登记表、状态机出口
  bot/                webhook 分发、命令、私聊提示、管理员判定
  web/                initData 验签、Mini App API
public/               Mini App（index.html / app.js / styles.css / vendor/ / fonts/）
ui/                   Material Web 组件入口与 MD3 配色（esbuild 打包）
migrations/           D1 迁移
scripts/              set-webhook.mjs、smoke.mjs、build-ui.mjs
tests/                SSHSIG 真签名、initData、题库与筛查
```

## 开发与测试

```bash
cp .dev.vars.example .dev.vars   # 填 BOT_TOKEN / WEBHOOK_SECRET / ADMIN_IDS
npm run db:local                 # 本地 D1 建表
npm run dev                      # http://127.0.0.1:8787

npm test                         # 18 个单测（含真实 ssh-keygen 生成的 ed25519/rsa/ecdsa 签名）
npm run smoke                    # 端到端：mock Telegram + 本地 D1 + 完整链路
```

> 改了 `ui/` 或 `public/` 的组件后跑 `npm run build:ui` 重新打包（`npm run deploy` 会自动执行）。

`npm run smoke` 不碰真实 Telegram：它起一个 mock Bot API，跑通「入群申请 → 私聊按钮 → 登记公钥 → SSHSIG 验签 → 批准」「直接入群 → 禁言 → 答题失败 → 管理员 /pass → 解除禁言」「超时 → cron → decline」「审计查询 + 哈希链自检 + 越权 403」。

## 浏览器独立校验

直接访问站点（不通过 Telegram）时，页面会进入**独立校验模式**：

- 服务端签发一次性挑战（HMAC 令牌，有效期同 `VERIFY_TTL_SECONDS`，默认 5 分钟）
- 用户填 GitHub 用户名、对挑战串签名、粘回来
- 服务端拉 `github.com/<用户名>.keys` 验签，只返回校验结果
- nonce 一次性：校验时原子消费，同一份签名重放返回 409
- 按 IP 每天限 3 次（`VERIFY_DAILY_LIMIT`），超了提示明天再来

接口：`GET /api/github/challenge` → `POST /api/github/check`。

## 界面（Material 3）

- 组件来自官方 `@material/web`（含 labs：elevated/filled card、segmented button、badge），
  由 `ui/vendor.ts` 统一注册，`scripts/build-ui.mjs` 打成 `public/vendor/material.js`，本地自托管。
- 配色是运行时算的：种子色 → `themeFromSourceColor` → 完整 light/dark scheme，
  写进 `--md-sys-color-*`。surface container 阶梯（`surface-container-low` 等）
  按 MD3 规范从 neutral 调色板取 tone 值。
- 种子色优先级：`?seed=` > Telegram 主题的 `button_color` > 默认品牌色。
- 主题：跟随 `?theme=` / localStorage / Telegram `colorScheme`，右上角可切换。
- 视觉语言：primary-container 做 hero、secondary/tertiary-container 做步骤与统计、无边框
  tonal elevation 做卡片、28px 大圆角、display/headline 级字阶对比、segmented button 切换方式、
  成功用 `md-dialog` 呈现。
- 浏览器预览：`/?preview=1`（示例数据，不会提交），支持 `&theme=dark`、`&seed=%233390EC`。

## 从 YumeBot 带过来的映射

| YumeBot | paffbot |
|---|---|
| `BOT_TOKEN` | 同名 |
| `MINI_APP_URL` | 同名（可选，自动推导） |
| `BILIBILI_ADMIN_ID` | 丢弃（B 站功能不迁） |
| `TELEGRAM_API_*` | 丢弃（serverless 无本地 Bot API server） |
| `config.conf` + entrypoint 生成 | wrangler vars / secrets |
| 内存 `unordered_map` 待验证表 | D1 + CAS |
| 5 分钟超时（内存定时器） | Cron 每分钟扫 + 惰性判定 |
| 客户端 `sendData` 自证 | 服务端验签后直接放行 |
| GitHub SSH 验证（客户端算） | Worker 拉 `github.com/<user>.keys` 服务端验签 |
| stdout 日志 | `verifications` + `audit_log` 哈希链 |
