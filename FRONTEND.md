# 前端设计准则

这份文档描述 Mini App 前端（`public/` + `ui/`）的做法与红线。目标是让另一个 Agent 在不读完全部代码的情况下，能写出风格一致、不返工的实现。

**范围**：只讲前端。后端接口、Telegram 交互另见 `docs/DEPLOY.md`、`docs/VARIABLES.md`。

---

## 0. 三条不可协商的前提

1. **文案由人写，不由 Agent 写。**
   Agent 的职责是把字符串抽成 key、保证中英两份、给出占位值；**不要**自行发挥营销腔、形容词、语气词。新写的文案必须在交付说明里列出来，供人改写。

2. **不用位图做界面元素。**
   图标是内联 SVG（`ICONS` 表），装饰是程序生成的形状（`public/shapes.js`），线稿是 SVG path。唯一的位图是应用图标（`icon-192.png` 等）。

3. **不用浏览器原生控件。**
   没有原生 `<select>`、`<input type="checkbox">`、原生按钮样式。要么用 Material Web（`md-filled-button` / `md-switch` / `md-outlined-text-field`），要么自绘（`.segmented`、`.dd`）。原因很实际：macOS 上原生下拉是这样的——

   > 用户原话：「macOS 上的原生下拉太丑了，不要用原生的」

---

## 1. 技术栈与构建

| 层 | 选择 | 说明 |
|---|---|---|
| 组件 | `@material/web` 的子集 | 只 import 用到的，见 `ui/vendor.ts` |
| 主题 | `@material/material-color-utilities` | 种子色 → 完整 MD3 调色板 |
| 打包 | `esbuild` | `npm run build:ui` → `public/vendor/material.js` |
| 页面 | 原生 ESM + 手写 DOM | 没有框架、没有虚拟 DOM、没有构建步骤 |

**为什么要自托管组件**：Telegram 内置浏览器在部分网络下取不到外部 CDN，所以组件打包进 `public/vendor/`，不引任何外部脚本。

**新增组件**：在 `ui/vendor.ts` 里加一行 import，跑 `npm run build:ui`，确认体积增长可接受（每个组件约 10–20 KiB）。

**改静态资源必须改版本号**：

```html
<link rel="stylesheet" href="./styles.css?v=59" />
<script type="module" src="./app.js?v=90"></script>
```

Telegram WebView 缓存很顽固，不加 `?v=` 用户会拿着旧文件跑。改完 CSS/JS 都要 +1。

---

## 2. 设计令牌与主题

所有颜色只用 CSS 变量，**不写死十六进制**：

```css
var(--md-sys-color-primary)
var(--md-sys-color-on-primary-container)
var(--md-sys-color-surface-container-high)
```

规则：

- 文字用 `on-*` 配对色，容器用 `*-container`，分隔线用 `outline-variant` 的 22% 混合。
- 需要「淡一点」时用 `color-mix(in srgb, <token> N%, transparent)`，不要再定义一层变量。
- 圆角跟形状走：卡片 24px 起，按钮胶囊，输入框 12px，小控件 8px。
- 字体族用 `var(--md-ref-typeface-plain)`，等宽场景 `var(--md-ref-typeface-mono)`。

主题由 `paintTheme()` 统一落地：`applyTheme({ seed, dark })` 把整套 `--md-sys-color-*` 写到 `documentElement`，再换图标和 aria 文案。

- 种子色优先级：`?seed=` → Telegram 主题的 `button_color` → 品牌默认 `#5060B0`。
- `theme-toggle` 只做「切 `dark` 布尔 → 存 localStorage → 重画」，不要在别处再算一遍色板。
- 用户手动切过主题后，Telegram 的 `themeChanged` 事件不再覆盖（以本地存值为准）。

圆角走变量：`--shape-pill`（胶囊）、`--shape-hero`（大卡片）、输入框与列表行 12px。

---

## 3. 页面骨架

```
.page
├── .page-top            顶部：logo + .segmented 导航 + 主题/语言
├── .hero                主视觉：eyebrow / 标题 / 副标题 / 形状装饰
├── .panel               内容卡片（一个视图一张）
└── footer               版权 + 语言选择
```

导航是**分段按钮**，不是 tab 条：

```html
<div class="segmented" role="tablist" aria-label="...">
  <button type="button" role="tab" data-view="verify" aria-selected="true" data-i18n="nav.verify"></button>
  <button type="button" role="tab" data-view="audit" aria-selected="false" data-i18n="nav.audit"></button>
</div>
```

- 选中态靠 `aria-selected="true"`，样式写 `[aria-selected="true"]`，不要另加 class。
- 可见性用 `.hidden`（`display: none !important`）在 `applyNavVisibility()` 里统一控制。
- 视图切换只切 `.view` 的 `.hidden`，不重建 DOM。

### 三种状态，一套壳

`showState(name)` 只认 `loading` / `empty` / `pending`：

- **loading**：骨架或 spinner，占位高度要和最终内容接近，避免跳动。
- **empty**：图标 + 标题 + 一句话说明 + 一个可操作按钮。
- **pending**：hero 加倒计时 + 主面板。

hero 的 `hero-progress` 是**波浪进度条**（`wavePath()` 生成 SVG，比视口宽一个波长，`translateX` 循环不露缝），只在 pending 状态出现。

---

## 4. 组件清单与用法

| 场景 | 用什么 | 不要用 |
|---|---|---|
| 主操作 | `md-filled-button` | 自绘蓝色矩形 |
| 次操作 | `md-outlined-button` / `md-text-button` | `<button class="link">` |
| 二选一/三选一 | `.segmented` + `aria-selected` | 原生 select |
| 布尔项 | `md-switch` | 原生 checkbox |
| 文本输入 | `md-outlined-text-field` | 原生 input（设置页除外，见下） |
| 图标按钮 | `md-icon-button` + `md-icon` + 内联 SVG | 图标字体 |
| 提示 | 面板内 `<p class="captcha__err">` | `alert()` |

### 设置页的特殊处理

设置页字段多、结构固定，用自绘行而不是一套 `md-outlined-text-field`：

```html
<div class="settings__row">
  <span class="settings__label">VERIFY_TTL_SECONDS</span>
  <input class="settings__input" type="number" data-key="..." />
  <p class="settings__hint">说明文字</p>
</div>
```

- 标签就是**变量名本身**（等宽字体），不翻译。
- 说明文字一律走 i18n key（`hintKey`），服务端只下发 key，不下发文案。
- 密钥字段永远 `value=""` + `placeholder="已设置，重新输入以覆盖"`，只报「有没有值」。

### 多值输入（`intList` / `list`）

一行一个值，末尾 `+` 追加；**第二行起**在 `+` 右边多一个 `−`：

```
┌──────────────┐ ┌─┐
│ 1762053255   │ │+│
└──────────────┘ └─┘
┌──────────────┐ ┌─┐ ┌─┐
│ 1234567890   │ │+│ │−│
└──────────────┘ └─┘ └─┘
```

增删后**整段重画**（`renderIntList(list, values, focusIndex)`），不要在 DOM 上做手术——「第一行不能有减号」「最后一行必须有加号」这类约束重画一次就自洽了。

### 只读 + 复制

由服务端推导的值（如 OAuth 回调地址）渲染成只读输入框 + 右侧复制按钮：

```html
<div class="settings__readonly">
  <input class="settings__input" readonly value="https://.../api/oauth/github/callback" />
  <button type="button" class="settings__round" data-copy="...">⧉</button>
</div>
```

点完按钮变 `✓`，1.2 秒后复原；复制失败时退回 `select() + execCommand('copy')`（Telegram WebView 里 clipboard API 不一定可用）。

---

## 5. 交互规范

### 按钮的三种状态

```js
button.setAttribute("disabled", "");        // 禁用要用属性，不是 property
button.textContent = t("gate.admin.opening"); // 加载文案写在按钮上
button.removeAttribute("disabled");          // 恢复
```

**不要**在按钮下方另起一行写「正在加载…」——用户原话：「点了按钮下面的提示改到按钮上，不要单独写在下面那一行」。

Material 组件有个坑：`el.disabled = true` 之后 `el.disabled = false` 有时属性还在，所以禁用/恢复都用 `setAttribute` / `removeAttribute`，必要时 `customElements.whenDefined()` 之后再操作。

### 错误展示

- 就地展示：在触发它的面板内写一行红字，不弹模态。
- 服务端如果给了 `errorKey`，前端优先翻译：`err.errorKey ? t(err.errorKey) : err.message`。
- 只有「流程结束」才用 `showResultDialog()`（成功/失败共用同一个对话框）。

### 空态与首屏

首屏不闪白：先把 hero 和面板渲染成 loading 骨架，会话请求回来再替换。请求失败时把原因写进空态说明，不要只留一个转圈。

### 浏览器门禁（非 Telegram 环境）

不在 Telegram 里打开时，页面**只留一个入口**，不提供任何验证表单：

- `/` → 「打开 Bot」按钮，跳 `https://t.me/<bot>`
- `/admin` → 「验证身份」按钮 → 服务端发 nonce → 打开 `?start=admin_<nonce>` → Bot 回一次性链接

门禁状态下隐藏导航栏（`$("nav").classList.add("hidden")`），登录成功后再显示。

---

## 6. 文案规则（最容易返工的地方）

### 面向使用者，不面向开发者

设置项说明只回答两件事：**这项是干什么的**、**我该怎么填**。

| ❌ 不要 | ✅ 要 |
|---|---|
| 启用后必须选一种，不做推断；关闭时这项不生效 | 启用后需要选择一种验证方式 |
| 留空则按请求来源推导 | 留空则使用当前访问地址 |

用户原话：「你面向的对象是使用者，而不是需要知道你的逻辑的开发者」。

### 标点与格式

- 冒号用**半角 + 空格**：`用法: /pass <uid>`，不是 `：`。
- 按钮文案不加 emoji、不加句号、不加感叹号。
- 一句话说明不写「为了……」「以便……」，直接说结果。
- 数字与中文之间按排版习惯留空格；单位紧贴数字（`300 秒`、`24 小时`）。

### 不猜、不做隐式推断

一个开关就是开/关，一个二选一就是明确选项。**任何「留空自动推断」的行为都是设计缺陷**——它会让用户无法预测当前状态。

对应实现：`resolveCaptchaProvider()` 只认 `cap` / `turnstile` 两个字面值，其他一律视为未配置。

### 长文案的位置

- 标题 ≤ 14 字，说明 ≤ 40 字。
- 超过两行的说明改用列表或拆成步骤（`.steps`）。
- 不写「请」「您」等敬语，用「你」。

---

## 7. i18n 机制

### 结构与约束

```
public/i18n/zh-CN.js   ← 中文（人写，Agent 只做占位）
public/i18n/en.js      ← 英文
public/i18n/index.js   ← t / setLang / detectLang / applyStaticI18n
```

- **key 按字母序排列**，中英两份**键数必须一致**（有测试兜底）。
- 命名空间：`nav.*` `hero.*` `panel.*` `settings.*` `gate.*` `audit.*` `dialog.*` `state.*` `foot.*`。
- 带参数用 `{name}` 占位：`t("hero.remaining", { time: "04:59" })`。

### 静态文案

写在 HTML 上，由 `applyStaticI18n()` 扫描：

```html
<h2 data-i18n="settings.title"></h2>
<input data-i18n-label="audit.tokenLabel" />
<div data-i18n-aria="nav.theme"></div>
<img data-i18n-alt="app.name" />
```

### 动态文案

JS 拼出来的 DOM 必须自己调 `t()`，并且**在语言切换时重渲染**：

```js
function retranslate() {
  document.title = t("page.title");
  applyStaticI18n();
  renderFooter();                       // 页脚是模块加载时渲染的，必须重画

  if (!$("view-settings").classList.contains("hidden")) {
    if (settingsState.fields.length > 0) renderSettings();
    return;
  }
  if (!$("view-audit").classList.contains("hidden")) {
    loadAudit();
    return;
  }
  renderHeroAndPanel();                 // 其余视图同理
}
```

反例（真实踩过）：页脚在模块顶层渲染了一次，那时还没 `setLang`，于是英文界面页脚永远是中文——因为没人重画它。

### 服务端下发的文案

服务端**不下发面向用户的自然语言**，只下发 key：

```ts
{ key: "CAPTCHA_URL", hintKey: "settings.hint.CAPTCHA_CAPJS_URL", ... }
```

错误也一样：`{ error: "至少要保留一个超级管理员", errorKey: "settings.error.needAdmin" }`，前端优先用 `errorKey`。

---

## 8. 可访问性

- tab 用 `role="tablist"` / `role="tab"` + `aria-selected`。
- 图标按钮必须有 `aria-label`（走 `data-i18n-aria`）。
- 装饰性 SVG 加 `aria-hidden="true"`。
- 焦点样式写 `:focus-visible`，不要给 `:focus` 画全局 outline（触屏会残留）。
- 可点击区域的命中高度 ≥ 40px；圆形按钮 38–40px。

---

## 9. 验证方法

改完不是「看起来对」就算完，按顺序做：

1. **类型检查**：`npx tsc -p ui --noEmit`（`ui/` 有独立 tsconfig）。
2. **构建**：`npm run build:ui`，确认 `material.js` 体积没有意外暴涨。
3. **真实页面截图**：headless Chrome + CDP，注入 initData 后打开目标路由，截图看排版。
   - 手机上跑的东西，**必须在 390–430px 宽度下看**，桌面宽度不算数。
   - 浅色/深色各看一次。
4. **中文/英文各看一次**：动态区块（设置页、审计页、页脚）最容易漏翻译。
5. **交互回归**：按钮禁用→恢复、复制按钮、多值增删、语言切换后不丢已填内容。

排版类问题优先看「盒子」而不是「文字」：`text-align: center` 只居中盒内内容，盒子本身还贴在左边——真实踩过，`max-width` 段落加 `margin: auto` 才真的居中。

---

## 10. 反模式清单

| 反模式 | 为什么不行 |
|---|---|
| 用位图做图标/插图 | 缩放糊、主题色改不了 |
| 用原生 `<select>` / checkbox | 各平台样式不一致，macOS 尤其难看 |
| 在 UI 里写实现细节（「不做推断」「按来源推导」） | 用户不关心你的逻辑 |
| 文案硬编码在 JS/服务端 | 切语言切不掉 |
| 只加中文不加英文 | 键数不一致，英文用户看到中文 |
| 新文案自己发挥 | 文案归属人，Agent 只做占位 |
| 加载提示另起一行 | 视觉噪音，按钮上写就够了 |
| 用 `el.disabled = false` 解禁 Material 组件 | 属性可能残留，用 `removeAttribute` |
| 静态资源不加 `?v=` | Telegram WebView 缓存旧文件 |
| 只改 CSS 不看深色模式 | `--md-sys-color-*` 之外写死颜色必翻车 |

---

## 11. 提交前检查表

- [ ] 没有新增位图
- [ ] 没有原生 select / checkbox
- [ ] 所有新字符串都是 i18n key，中英各一份，字母序
- [ ] 按钮文案没加 emoji / 句号
- [ ] 冒号是半角 `: `
- [ ] 说明文字面向用户，不解释内部逻辑
- [ ] 加载态写在按钮上
- [ ] 语言切换后动态区块会重画
- [ ] 430px 宽 + 深色模式截图确认
- [ ] `app.js?v=` / `styles.css?v=` 已递增

---

## 附：目录速查

```
public/
├── index.html          页面骨架（静态文案挂 data-i18n）
├── app.js              全部交互逻辑（单文件，约 2000 行）
├── styles.css          设计令牌 + 组件样式
├── shapes.js           Material Shapes 形状库（SVG path 生成）
├── vendor/
│   ├── material.js     打包好的 Material Web 子集
│   └── telegram-web-app.js
└── i18n/
    ├── index.js        t / setLang / applyStaticI18n
    ├── zh-CN.js
    └── en.js

ui/
├── vendor.ts           组件入口（决定打哪些组件）
└── theme.ts            种子色 → MD3 调色板

scripts/build-ui.mjs    esbuild 打包 vendor.ts
```
