import { applyTheme, telegramSeed, DEFAULT_SEED } from "./vendor/material.js";
import { shapeMask, shapeSvg } from "./shapes.js";

/* ---------------------------------------------------------------- 基础环境 */

const tg = window.Telegram?.WebApp;
const params = new URLSearchParams(location.search);
const PREVIEW = params.get("preview") === "1";
const GITHUB_SSH_DOC =
  "https://docs.github.com/zh/authentication/connecting-to-github-with-ssh/generating-a-new-ssh-key-and-adding-it-to-the-ssh-agent";

const ICONS = {
  dark: '<path d="M12 21q-3.75 0-6.375-2.625T3 12q0-3.75 2.625-6.375T12 3q.35 0 .688.025t.662.075q-1.025.725-1.638 1.887T11.1 7.5q0 2.25 1.575 3.825T16.5 12.9q1.375 0 2.537-.613T20.925 10.65q.05.325.062.662Q21 11.65 21 12q0 3.75-2.625 6.375T12 21Z"/>',
  light:
    '<path d="M12 17q-2.075 0-3.537-1.463T7 12q0-2.075 1.463-3.537T12 7q2.075 0 3.537 1.463T17 12q0 2.075-1.463 3.537T12 17Zm0-2q1.25 0 2.125-.875T15 12q0-1.25-.875-2.125T12 9q-1.25 0-2.125.875T9 12q0 1.25.875 2.125T12 15Zm0-10v-2m0 18v-2M5 12H3m18 0h-2M6.4 6.4 5 5m14 14-1.4-1.4M6.4 17.6 5 19M19 5l-1.4 1.4"/>',
  check: '<path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm-1.2 14.6-4.6-4.6L7.6 10.6l3.2 3.2 6-6L18.2 9.2l-7.4 7.4Z"/>',
  shield:
    '<path d="M12 2 4 5v6c0 5 3.4 9.7 8 11 4.6-1.3 8-6 8-11V5l-8-3Zm0 2.2 6 2.2V11c0 3.9-2.5 7.6-6 8.8-3.5-1.2-6-4.9-6-8.8V6.4l6-2.2Z"/>',
  list: '<path d="M4 6h2v2H4V6Zm4 0h12v2H8V6ZM4 11h2v2H4v-2Zm4 0h12v2H8v-2ZM4 16h2v2H4v-2Zm4 0h12v2H8v-2Z"/>',
  inbox:
    '<path d="M19 3H5a2 2 0 0 0-2 2v14l4-4h12a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2Zm0 12H6.17L5 16.17V5h14v10Z"/>',
  copy: '<path d="M16 1H4a2 2 0 0 0-2 2v14h2V3h12V1Zm3 4H8a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2Zm0 16H8V7h11v14Z"/>',
  error: '<path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm1 15h-2v-2h2v2Zm0-4h-2V7h2v6Z"/>',
  clock: '<path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm0 18a8 8 0 1 1 0-16 8 8 0 0 1 0 16Zm1-13h-2v6l5 3 1-1.7-4-2.3V7Z"/>',
  stack: '<path d="M12 3 2 8l10 5 10-5-10-5Zm0 7.8L4.5 7 12 3.2 19.5 7 12 10.8ZM2 16l10 5 10-5-1.8-.9L12 18.8 3.8 15.1 2 16Zm0-4 10 5 10-5-1.8-.9L12 14.8 3.8 11.1 2 12Z"/>',
};

function svgIcon(name, size = 20) {
  return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="currentColor" aria-hidden="true">${ICONS[name] ?? ""}</svg>`;
}

const $ = (id) => document.getElementById(id);
const esc = (value) =>
  String(value ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);

/* ---------------------------------------------------------------- 主题 */

const THEME_KEY = "paffbot.theme";
const seed = params.get("seed") || telegramSeed() || DEFAULT_SEED;
const storedTheme = localStorage.getItem(THEME_KEY);
const themeParam = params.get("theme");
let dark = themeParam
  ? themeParam === "dark"
  : storedTheme
    ? storedTheme === "dark"
    : tg?.colorScheme
      ? tg.colorScheme === "dark"
      : window.matchMedia("(prefers-color-scheme: dark)").matches;

const state = {
  verification: null,
  challenge: "",
  standalone: false,
  checkToken: "",
  shell: "bash",
  timer: 0,
  token: localStorage.getItem("paffbot.token") || "",
  botUsername: "",
  superAdmin: false,
  auditLoaded: false,
  oauthEnabled: false,
  githubLogin: "",
  oauthTimer: 0,
};

function paintTheme() {
  applyTheme({ seed, dark });
  $("theme-icon").innerHTML = svgIcon(dark ? "light" : "dark", 22);
  $("theme-toggle").setAttribute("aria-label", dark ? "切换到浅色" : "切换到深色");
}
paintTheme();

$("theme-toggle").addEventListener("click", () => {
  dark = !dark;
  localStorage.setItem(THEME_KEY, dark ? "dark" : "light");
  paintTheme();
});

if (tg) {
  tg.ready();
  tg.expand();
  try {
    tg.setHeaderColor?.("#00000000");
    tg.setBackgroundColor?.("bg_color");
  } catch {}
  tg.onEvent?.("themeChanged", () => {
    if (localStorage.getItem(THEME_KEY)) return;
    dark = tg.colorScheme === "dark";
    paintTheme();
  });
}

/* ---------------------------------------------------------------- 通用 */

async function api(path, options = {}) {
  const headers = { "content-type": "application/json", ...(options.headers || {}) };
  if (tg?.initData) headers["X-Telegram-Init-Data"] = tg.initData;
  else if (state.token) headers["Authorization"] = `Bearer ${state.token}`;

  const res = await fetch(path, { ...options, headers });
  let data = {};
  try {
    data = await res.json();
  } catch {
    data = { ok: false, error: `服务返回了非 JSON（HTTP ${res.status}）` };
  }
  if (!res.ok || data.ok === false) {
    const error = new Error(data.error || `HTTP ${res.status}`);
    error.status = res.status;
    throw error;
  }
  return data;
}

let toastTimer = 0;
function toast(message) {
  const el = $("toast");
  el.textContent = message;
  el.classList.remove("hidden");
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => el.classList.add("hidden"), 4200);
}

function setHero({ eyebrow, title, sub, chips = null, group = null }) {
  if (eyebrow !== undefined) $("hero-eyebrow").textContent = eyebrow;
  if (title !== undefined) $("hero-title").textContent = title;
  if (group) {
    // 群头像走 /api/group/photo，由服务端带 token 去 Telegram 取，前端拿不到 token
    $("hero-sub").innerHTML = `<span class="hero__group"><img class="hero__group-avatar" src="${esc(
      group.photo,
    )}" alt="" loading="lazy" onerror="this.remove()" /><span>${esc(group.title)}</span></span>`;
  } else if (sub !== undefined) {
    $("hero-sub").textContent = sub;
  }
  if (chips !== null) {
    const box = $("hero-chips");
    box.innerHTML = "";
    for (const chip of chips) {
      const el = document.createElement("span");
      el.className = chip.strong ? "chip chip--strong" : "chip";
      if (chip.id) el.id = chip.id;
      el.textContent = chip.text;
      box.appendChild(el);
    }
  }
}

function showState(name) {
  $("state-loading").classList.toggle("hidden", name !== "loading");
  $("state-empty").classList.toggle("hidden", name !== "empty");
  $("pending").classList.toggle("hidden", name !== "pending");
  $("hero-progress").classList.toggle("hidden", name !== "pending");
}

/* ---------------------------------------------------------------- 会话 */

async function loadSession() {
  if (PREVIEW) {
    renderPreview();
    return;
  }
  try {
    const data = await api("/api/session");
    state.verification = data.verification;
    state.botUsername = data.botUsername || "";
    state.superAdmin = Boolean(data.superAdmin);
    state.oauthEnabled = Boolean(data.oauth?.enabled);
    state.githubLogin = data.github?.login || "";

    if (!data.verification) {
      const name = data.user?.name?.split(" ")[0];
      setHero({
        eyebrow: "芙 Bot · 入群验证",
        title: name ? `你好，${name}` : "暂无待验证",
        sub: "在群里点「申请加入」后，我会私聊你验证入口；也可以先看看审计。",
        chips: [],
      });
      applyNavVisibility();
      showState("empty");
      return;
    }

    const v = data.verification;
    setHero({
      eyebrow: "芙 Bot · 入群验证",
      title: "完成 GitHub 签名即可入群",
      sub: v.chatTitle ?? String(v.chatId),
      group: { title: v.chatTitle ?? String(v.chatId), photo: v.chatPhoto || "" },
      chips: [{ text: "剩余 05:00", id: "hero-countdown", strong: true }],
    });
    applyNavVisibility();
    showState("pending");
    startCountdown(v.expiresAt);
    await loadPanel();
  } catch (err) {
    if (err.status === 401 && !tg?.initData) {
      await enterStandalone();
    } else {
      showState("empty");
      $("empty-title").textContent = "加载失败";
      $("empty-text").textContent = err.message;
      setHero({ eyebrow: "芙 Bot", title: "出错了", sub: err.message, chips: [] });
    }
  }
}

async function loadPanel() {
  const panel = $("method-panel");
  panel.innerHTML = '<p class="md-typescale-body-medium muted">加载中…</p>';
  if (PREVIEW) {
    const fake = { challenge: state.challenge, requirements: { minAccountAgeDays: 0, requiredOrg: null } };
    if (state.oauthEnabled) {
      renderMethodPanel(panel, fake);
      return;
    }
    renderGithubPanel(panel, fake);
    const button = $("gh-submit");
    button.disabled = true;
    button.textContent = "预览模式（不可提交）";
    return;
  }
  try {
    const data = await api(
      `/api/verify/start?method=github&verificationId=${encodeURIComponent(state.verification.id)}`,
    );
    state.challenge = data.challenge || "";
    renderMethodPanel(panel, data);
  } catch (err) {
    panel.innerHTML = `<p class="md-typescale-body-medium" style="color:var(--md-sys-color-error)">${esc(err.message)}</p>`;
  }
}

/** 面板顶部的方式切换：签名（纯前端算） / OAuth（要跳 GitHub）。 */
function renderMethodPanel(panel, data) {
  if (state.standalone || !state.oauthEnabled) {
    renderGithubPanel(panel, data);
    return;
  }

  panel.innerHTML = `
    <div class="segmented segmented--sm panel__switch" role="tablist" aria-label="验证方式" id="pm-switch">
      <button type="button" role="tab" data-method="ssh" aria-selected="true">SSH 签名</button>
      <button type="button" role="tab" data-method="oauth" aria-selected="false">GitHub OAuth</button>
    </div>
    <div id="pm-body"></div>`;

  const body = $("pm-body");
  const switchTo = (method) => {
    for (const b of $("pm-switch").querySelectorAll("button")) {
      b.setAttribute("aria-selected", String(b.dataset.method === method));
    }
    stopOAuthPolling();
    if (method === "oauth") renderOAuthPanel(body);
    else renderGithubPanel(body, data);
  };

  for (const b of $("pm-switch").querySelectorAll("button")) {
    b.addEventListener("click", () => switchTo(b.dataset.method));
  }
  switchTo("ssh");
}

function stopOAuthPolling() {
  if (state.oauthTimer) {
    clearInterval(state.oauthTimer);
    state.oauthTimer = 0;
  }
}

/** OAuth：在系统浏览器里授权，Mini App 轮询绑定结果。 */
function renderOAuthPanel(panel) {
  panel.innerHTML = `
    <div class="panel__head">
      <h2 class="md-typescale-headline-medium">GitHub OAuth</h2>
      <p class="md-typescale-body-medium muted">
        在 GitHub 上授权后自动建立账号绑定，不需要在终端操作，也不读取你的私有仓库。
        ${state.githubLogin ? `当前已绑定 <b>${esc(state.githubLogin)}</b>。` : ""}
      </p>
    </div>
    <div class="actions">
      <md-filled-button id="oauth-start">使用 GitHub 授权</md-filled-button>
    </div>
    <p class="md-typescale-body-small muted" id="oauth-status" style="margin-top:16px"></p>`;

  $("oauth-start").addEventListener("click", async () => {
    const button = $("oauth-start");
    button.disabled = true;
    $("oauth-status").textContent = "正在跳转 GitHub…";

    try {
      const data = await api(
        `/api/oauth/github/start?verificationId=${encodeURIComponent(state.verification.id)}`,
      );
      const url = data.url;
      if (tg?.openLink) tg.openLink(url);
      else window.open(url, "_blank", "noopener");

      $("oauth-status").textContent = "已在新窗口打开 GitHub，完成授权后这里会自动更新。";
      stopOAuthPolling();
      state.oauthTimer = window.setInterval(async () => {
        try {
          const status = await api("/api/oauth/github/status");
          if (status.bound) {
            stopOAuthPolling();
            state.githubLogin = status.bound.login;
            $("oauth-status").textContent = `已绑定 ${status.bound.login}`;
            onApproved({ chatTitle: state.verification?.chatTitle });
          }
        } catch {
          /* 网络抖动时继续轮询 */
        }
      }, 2000);
    } catch (err) {
      $("oauth-status").textContent = err.message;
      button.disabled = false;
    }
  });
}

/* ---------------------------------------------------------------- GitHub SSH */

function githubCommand(shell) {
  return shell === "pwsh"
    ? `"${state.challenge}" | ssh-keygen -Y sign -f $HOME/.ssh/id_ed25519 -n file -`
    : `echo "${state.challenge}" | ssh-keygen -Y sign -f ~/.ssh/id_ed25519 -n file -`;
}

function renderGithubPanel(panel, data, mode = "verify") {
  const standalone = mode === "standalone";
  const requirements = data.requirements || {};
  const notes = [];
  if (requirements.minAccountAgeDays > 0) notes.push(`账号需注册满 ${requirements.minAccountAgeDays} 天`);
  if (requirements.requiredOrg) notes.push(`需属于组织 ${requirements.requiredOrg}`);

  panel.innerHTML = `
    <div class="panel__head">
      <h2 class="md-typescale-headline-medium">${standalone ? "GitHub 账号校验" : "GitHub SSH"}</h2>
      <p class="md-typescale-body-medium muted">
        ${standalone ? "用该账号已公开的公钥签名。" : "用已添加到 GitHub 的 SSH 私钥签名。"}
        <a href="${GITHUB_SSH_DOC}" target="_blank" rel="noreferrer">配置指南</a>
      </p>
      ${notes.length ? `<p class="md-typescale-body-small muted">额外要求：${esc(notes.join("；"))}</p>` : ""}
    </div>

    <ol class="steps">
      <li class="step">
        <div class="step__avatar tone-primary">1</div>
        <div class="step__body">
          <h3 class="md-typescale-title-medium">输入 GitHub 用户名</h3>
          <p class="md-typescale-body-medium muted">不带 @，例如 octocat</p>
          <md-outlined-text-field id="gh-username" label="GitHub 用户名"></md-outlined-text-field>
        </div>
      </li>

      <li class="step">
        <div class="step__avatar tone-secondary">2</div>
        <div class="step__body">
          <h3 class="md-typescale-title-medium">在终端签名</h3>
          <p class="md-typescale-body-medium muted">私钥路径换成你自己的，输出即签名。</p>
          <div class="code">
            <div class="code__head">
              <div class="segmented segmented--sm" role="tablist" aria-label="终端" id="gh-shells"></div>
            </div>
            <pre id="gh-cmd"></pre>
            <div class="code__foot">
              <md-text-button id="gh-copy">${svgIcon("copy", 18)}<span>复制</span></md-text-button>
            </div>
          </div>
        </div>
      </li>

      <li class="step">
        <div class="step__avatar tone-tertiary">3</div>
        <div class="step__body">
          <h3 class="md-typescale-title-medium">粘贴签名</h3>
          <md-outlined-text-field id="gh-signature" type="textarea" rows="5" label="SSH 签名"></md-outlined-text-field>
        </div>
      </li>
    </ol>

    <div class="panel__actions">
      <md-filled-button id="gh-submit" disabled>${standalone ? "校验签名" : "验证并放行"}</md-filled-button>
    </div>
    <p class="md-typescale-body-small hidden" id="gh-error" style="color:var(--md-sys-color-error);margin-top:12px"></p>
  `;

  const shells = $("gh-shells");
  const syncShells = () => {
    for (const button of shells.querySelectorAll("button")) {
      button.setAttribute("aria-selected", String(button.dataset.shell === state.shell));
    }
  };
  for (const [id, label] of [
    ["bash", "Bash"],
    ["pwsh", "PowerShell"],
  ]) {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.shell = id;
    button.textContent = label;
    button.setAttribute("role", "tab");
    button.addEventListener("click", () => {
      state.shell = id;
      syncShells();
      $("gh-cmd").textContent = githubCommand(id);
    });
    shells.appendChild(button);
  }
  syncShells();
  $("gh-cmd").textContent = githubCommand(state.shell);

  $("gh-copy").addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(githubCommand(state.shell));
      toast("命令已复制");
    } catch {
      toast("复制失败，请手动选中命令");
    }
  });

  const username = $("gh-username");
  const signature = $("gh-signature");
  const submit = $("gh-submit");

  const refresh = () => {
    const name = username.value.trim().replace(/^@/, "");
    const nameOk = /^[a-z\d](?:[a-z\d-]{0,37}[a-z\d])?$/i.test(name);
    const sigOk = signature.value.includes("BEGIN SSH SIGNATURE");
    username.error = name.length > 0 && !nameOk;
    signature.error = signature.value.trim().length > 0 && !sigOk;
    submit.disabled = !(nameOk && sigOk);
  };
  username.addEventListener("input", refresh);
  signature.addEventListener("input", refresh);

  submit.addEventListener("click", async () => {
    submit.disabled = true;
    submit.textContent = standalone ? "校验中…" : "验证中…";
    $("gh-error").classList.add("hidden");
    try {
      if (standalone) {
        const result = await api("/api/github/check", {
          method: "POST",
          body: JSON.stringify({
            token: state.checkToken,
            username: username.value.trim(),
            signature: signature.value.trim(),
          }),
        });
        onStandaloneResult(result);
        submit.disabled = false;
        submit.textContent = "校验签名";
        return;
      }
      const result = await api("/api/verify/submit", {
        method: "POST",
        body: JSON.stringify({
          method: "github",
          verificationId: state.verification.id,
          username: username.value.trim(),
          signature: signature.value.trim(),
        }),
      });
      onApproved(result);
    } catch (err) {
      $("gh-error").textContent = err.message;
      $("gh-error").classList.remove("hidden");
      toast(err.message);
      submit.disabled = false;
      submit.textContent = standalone ? "校验签名" : "验证并放行";
      if (standalone && (err.status === 409 || err.status === 400)) {
        await loadStandalonePanel();
      }
    }
  });
}

/* ---------------------------------------------------------------- 独立校验（无 Telegram） */

async function enterStandalone() {
  state.standalone = true;
  showState("pending");
  setHero({
    eyebrow: "芙 Bot",
    title: "确认 GitHub 账号",
    sub: "用该账号已公开的公钥签名，确认归属。",
    chips: [],
  });
  await loadStandalonePanel();
}

async function loadStandalonePanel() {
  const panel = $("method-panel");
  panel.innerHTML = '<p class="md-typescale-body-medium muted">准备挑战串…</p>';
  try {
    const data = await api("/api/github/challenge");
    state.checkToken = data.token;
    state.challenge = data.challenge;
    setHero({
      eyebrow: "芙 Bot",
      title: "确认 GitHub 账号",
      sub: "用该账号已公开的公钥签名，确认归属。",
      chips: [
        ...(typeof data.remaining === "number" ? [{ text: `今天还剩 ${data.remaining} 次` }] : []),
        { text: "剩余 05:00", id: "hero-countdown", strong: true },
      ],
    });
    startCountdown(data.expiresAt);
    renderGithubPanel(panel, { challenge: data.challenge, requirements: {} }, "standalone");
  } catch (err) {
    // 没有可用挑战：hero 里的进度条和按钮都不该再显示
    clearInterval(state.timer);
    $("hero-progress").classList.add("hidden");
    setHero({ chips: [] });

    panel.innerHTML = `
      <div class="state">
        <div class="state__icon">${svgIcon("clock", 26)}</div>
        <h2 class="md-typescale-headline-small">今天先到这里</h2>
        <p class="md-typescale-body-medium muted">${esc(err.message)}</p>
      </div>`;
  }
}

function onStandaloneResult(result) {
  $("dialog-title").textContent = "校验通过";
  $("dialog-icon").innerHTML = svgIcon("check", 30);
  $("dialog-text").innerHTML =
    `GitHub 账号 <b>${esc(result.githubUsername)}</b> 校验通过。` +
    `<br><span class="mono md-typescale-body-small">${esc(result.fingerprint ?? "")}</span>`;
  $("success-dialog").show();
}

/* ---------------------------------------------------------------- 状态 */

function onApproved(result) {
  clearInterval(state.timer);
  $("dialog-title").textContent = "验证通过";
  $("dialog-icon").innerHTML = svgIcon("check", 30);
  $("dialog-text").textContent = `已放行你加入「${result.chatTitle || "群组"}」，可以回到群聊了。`;
  $("success-dialog").show();
  try {
    tg?.HapticFeedback?.notificationOccurred("success");
  } catch {}
}

function startCountdown(expiresAt) {
  clearInterval(state.timer);
  const totalMs = Math.max(1, expiresAt - Date.now());
  const tick = () => {
    const left = Math.max(0, expiresAt - Date.now());
    const total = Math.floor(left / 1000);
    const text =
      left > 0
        ? `剩余 ${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`
        : "已过期";
    const chip = $("hero-countdown");
    if (chip) chip.textContent = text;
    const mask = $("wavy-mask");
    if (mask) {
      const pct = Math.max(0, Math.min(1, left / totalMs)) * 100;
      mask.style.setProperty("--pct", `${pct}%`);
    }
    if (left === 0) {
      clearInterval(state.timer);
      if (state.standalone) {
        $("method-panel").innerHTML = `
          <p class="md-typescale-body-medium muted">这次校验已过期。</p>
          <div class="panel__actions"><md-filled-tonal-button id="btn-new-challenge">重新获取</md-filled-tonal-button></div>`;
        $("btn-new-challenge").addEventListener("click", () => loadStandalonePanel());
      } else {
        $("method-panel").innerHTML =
          '<p class="md-typescale-body-medium muted">这次验证已超时，请回群里重新申请。</p>';
      }
    }
  };
  tick();
  state.timer = window.setInterval(tick, 1000);
}

/* ---------------------------------------------------------------- 预览 */

function renderPreview() {
  showState("pending");
  setHero({
    eyebrow: "芙 Bot · 入群验证",
    title: "完成 GitHub 签名即可入群",
    sub: "示例群 · Paff 测试群",
    group: { title: "示例群 · Paff 测试群", photo: "./icon-192.png" },
    chips: [{ text: "剩余 05:00", id: "hero-countdown", strong: true }],
  });

  const banner = document.createElement("div");
  banner.className = "preview-banner";
  banner.innerHTML = `<md-icon>${svgIcon("error", 20)}</md-icon><span>界面预览：示例数据，不会真正提交。真实验证请在 Telegram 里从 @P4ffBot 打开。</span>`;
  $("view-verify").insertBefore(banner, $("pending"));

  state.verification = {
    id: "preview",
    chatId: -1001234567890,
    chatTitle: "示例群 · Paff 测试群",
    expiresAt: Date.now() + 300_000,
  };
  state.challenge = "paffbot-verify:v1:preview-demo:8f3a1c2b";
  if (params.get("oauth") === "1") state.oauthEnabled = true;
  startCountdown(state.verification.expiresAt);
  loadPanel();
}

/* ---------------------------------------------------------------- 审计 */

async function loadAudit() {
  const chatId = $("audit-group")?.value ?? "";
  $("audit-hint").textContent = "加载中…";
  try {
    const query = chatId ? `?chatId=${encodeURIComponent(chatId)}` : "";
    const data = await api(`/api/audit/overview${query}`);
    $("audit-hint").textContent = `共 ${data.verificationsTotal} 条验证、${data.auditTotal} 条审计。`;
    renderAudit(data);
    $("token-card").classList.add("hidden");
  } catch (err) {
    $("audit-hint").textContent = `加载失败：${err.message}`;
    if (err.status === 401) $("token-card").classList.remove("hidden");
  }
}

const ACTION_LABEL = {
  "verification.created": "发起验证",
  "verification.approved": "验证通过",
  "verification.declined": "验证未通过",
  "verification.timeout": "验证超时",
  "verification.banned": "封禁用户",
  "verification.blocked": "自动拦截",
  "verification.rate_limited": "触发每日限额",
  "verification.dm_failed": "私聊发送失败",
  "telegram.action_failed": "Telegram 操作失败",
  "group.settings": "群设置更新",
};

const ACTOR_LABEL = { user: "用户", system: "系统", super_admin: "超级管理员", admin: "管理员" };

const METHOD_LABEL = {
  github: "GitHub 签名",
  button: "一键确认",
  admin_pass: "管理员放行",
  profile: "资料筛查",
  timeout: "超时",
};

const REASON_LABEL = {
  expired: "超过有效期",
  banned: "被管理员封禁",
  blocked: "命中拦截规则",
  admin_pass: "管理员手动放行",
  timeout: "等待超时",
  ok: "验证通过",
};

/** 把 Telegram 的英文报错翻成一句人话。 */
function humanError(raw) {
  if (/user is an admin/i.test(raw)) return "对方是群管理员，无法执行";
  if (/not enough rights|CHAT_ADMIN_REQUIRED/i.test(raw)) return "机器人在该群权限不足";
  if (/user not found|PARTICIPANT_ID_INVALID/i.test(raw)) return "用户不在该群";
  if (/message to delete not found/i.test(raw)) return "提示消息已被删除";
  if (/USER_IS_BLOCKED/i.test(raw)) return "对方拉黑了机器人";
  return "Telegram 接口调用失败";
}

/** 把审计 detail 对象翻成人话，不再直接吐 JSON。 */
function describeDetail(detail) {
  if (!detail || typeof detail !== "object") return "";
  const parts = [];
  if (detail.method) parts.push(METHOD_LABEL[detail.method] ?? detail.method);
  if (detail.reason) parts.push(REASON_LABEL[detail.reason] ?? detail.reason);
  if (detail.scope === "telegram") parts.push("入群申请");
  if (detail.mode === "group_join") parts.push("直接入群");
  if (detail.source === "admin" || detail.selftest) parts.push("自测");
  if (typeof detail.error === "string") parts.push(humanError(detail.error));
  return parts.join(" · ");
}

const STATUS_META = {
  approved: { label: "已放行", tone: "tone-primary" },
  pending: { label: "待验证", tone: "tone-secondary" },
  timeout: { label: "超时", tone: "tone-tertiary" },
  declined: { label: "已拒绝", tone: "tone-tertiary" },
  banned: { label: "已封禁", tone: "tone-error" },
  blocked: { label: "自动拦截", tone: "tone-error" },
};

/** 按浏览器本地时区显示（之前写死 UTC+8，非东八区用户会看到错的时间）。 */
function fmtTime(ts) {
  const d = new Date(ts);
  const p = (n) => String(n).padStart(2, "0");
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** 悬浮显示完整本地时间（含时区/秒），方便对表。 */
function fmtTimeFull(ts) {
  return new Date(ts).toLocaleString(undefined, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    timeZoneName: "short",
  });
}

/** 状态已经说明了方式时不再重复一行 */
function methodNote(row) {
  const method = row.method;
  if (!method || method === row.status) return "";
  const label = METHOD_LABEL[method];
  return label ? `<span class="cell-sub">${esc(label)}</span>` : "";
}

const auditView = {
  chatId: "",
  verify: { page: 1, status: "", q: "" },
  log: { page: 1, action: "", q: "" },
};

const STATUS_OPTIONS = [
  ["", "全部状态"],
  ["pending", "待验证"],
  ["approved", "已放行"],
  ["timeout", "超时"],
  ["declined", "已拒绝"],
  ["banned", "已封禁"],
  ["blocked", "自动拦截"],
];

const ACTION_OPTIONS = [
  ["", "全部动作"],
  ["verification.created", "发起验证"],
  ["verification.approved", "验证通过"],
  ["verification.timeout", "验证超时"],
  ["verification.declined", "验证未通过"],
  ["verification.rate_limited", "触发限额"],
  ["telegram.action_failed", "Telegram 操作失败"],
];

function selectHtml(id, options) {
  return `<select class="select" id="${id}">${options
    .map(([value, label]) => `<option value="${esc(value)}">${esc(label)}</option>`)
    .join("")}</select>`;
}

function groupCell(title, id) {
  if (!title && !id) return '<div class="cell muted">—</div>';
  return `<div class="cell">${esc(title || String(id))}${
    title && id ? `<span class="cell-sub mono">${esc(id)}</span>` : ""
  }</div>`;
}

function verifyRowHtml(row) {
  const meta = STATUS_META[row.status] ?? { label: row.status, tone: "" };
  return `<tr>
    <td data-label="时间"><div class="cell mono" title="${esc(fmtTimeFull(row.createdAt))}">${fmtTime(row.createdAt)}</div></td>
    <td data-label="群">${groupCell(row.chatTitle, row.chatId)}</td>
    <td data-label="用户"><div class="cell">${esc(row.userName || row.userId)}<span class="cell-sub mono">${esc(row.userId)}</span></div></td>
    <td data-label="状态"><div class="cell"><span class="status-chip ${meta.tone}">${esc(meta.label)}</span></div></td>
    <td data-label="说明" class="muted"><div class="cell">${esc(
      REASON_LABEL[row.reason] ?? row.reason ?? "",
    )}${methodNote(row)}${row.operatorId ? `<span class="cell-sub">操作者 ${esc(row.operatorId)}</span>` : ""}</div></td>
  </tr>`;
}

function auditRowHtml(row) {
  return `<tr>
    <td data-label="时间"><div class="cell mono" title="${esc(fmtTimeFull(row.ts))}">${fmtTime(row.ts)}</div></td>
    <td data-label="群">${groupCell(row.chatTitle, row.chatId)}</td>
    <td data-label="操作者"><div class="cell">${esc(ACTOR_LABEL[row.actorType] ?? row.actorType)}${
      row.actorId ? `<span class="cell-sub mono">${esc(row.actorId)}</span>` : ""
    }</div></td>
    <td data-label="动作"><div class="cell">${esc(ACTION_LABEL[row.action] ?? row.action)}</div></td>
    <td data-label="详情" class="muted"><div class="cell">${
      esc(describeDetail(row.detail)) || "—"
    }${row.targetUserId ? `<span class="cell-sub mono">用户 ${esc(row.targetUserId)}</span>` : ""}</div></td>
  </tr>`;
}

function pagerHtml(prefix, page, total, pageSize) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return `<button type="button" class="pager__btn" id="${prefix}-prev" ${page <= 1 ? "disabled" : ""}>上一页</button>
    <span class="pager__info">第 ${page} / ${pages} 页 · 共 ${total} 条</span>
    <button type="button" class="pager__btn" id="${prefix}-next" ${page >= pages ? "disabled" : ""}>下一页</button>`;
}

async function loadVerifyPage() {
  const view = auditView.verify;
  const params = new URLSearchParams({ chatId: auditView.chatId, page: String(view.page), pageSize: "20" });
  if (view.status) params.set("status", view.status);
  if (view.q) params.set("q", view.q);

  const tbody = $("v-rows");
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="5" class="muted">加载中…</td></tr>';
  try {
    const data = await api(`/api/audit/verifications?${params.toString()}`);
    tbody.innerHTML = data.rows.map(verifyRowHtml).join("") || '<tr><td colspan="5" class="muted">没有匹配的记录</td></tr>';
    $("v-count").textContent = `${data.total} 条`;
    $("v-pager").innerHTML = pagerHtml("v", data.page, data.total, data.pageSize);
    bindPager("v", "verify", loadVerifyPage);
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="5" class="muted">加载失败：${esc(err.message)}</td></tr>`;
  }
}

async function loadLogPage() {
  const view = auditView.log;
  const params = new URLSearchParams({ chatId: auditView.chatId, page: String(view.page), pageSize: "20" });
  if (view.action) params.set("action", view.action);
  if (view.q) params.set("q", view.q);

  const tbody = $("a-rows");
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="5" class="muted">加载中…</td></tr>';
  try {
    const data = await api(`/api/audit/log?${params.toString()}`);
    tbody.innerHTML = data.rows.map(auditRowHtml).join("") || '<tr><td colspan="5" class="muted">没有匹配的记录</td></tr>';
    $("a-count").textContent = `${data.total} 条`;
    $("a-pager").innerHTML = pagerHtml("a", data.page, data.total, data.pageSize);
    bindPager("a", "log", loadLogPage);
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="5" class="muted">加载失败：${esc(err.message)}</td></tr>`;
  }
}

function bindPager(prefix, key, reload) {
  const view = auditView[key];
  $(`${prefix}-prev`)?.addEventListener("click", () => {
    if (view.page > 1) {
      view.page -= 1;
      reload();
    }
  });
  $(`${prefix}-next`)?.addEventListener("click", () => {
    view.page += 1;
    reload();
  });
}

function renderAudit(data) {
  const stats = data.stats || {};
  const chain = data.chain || { ok: true, checked: 0 };
  const chainBadge = chain.ok
    ? `<span class="badge ok">哈希链完整 · ${chain.checked}</span>`
    : `<span class="badge bad">哈希链在 #${chain.brokenAtId} 断开</span>`;

  auditView.chatId = String(data.chatId ?? "");

  const groupSelect = $("audit-group");
  if (groupSelect) {
    const current = groupSelect.value || auditView.chatId;
    const options = [["", "全部群"]].concat(
      (data.groups ?? []).map((g) => [String(g.chatId), g.title || String(g.chatId)]),
    );
    groupSelect.innerHTML = options
      .map(([value, label]) => `<option value="${esc(value)}">${esc(label)}</option>`)
      .join("");
    groupSelect.value = options.some(([v]) => v === current) ? current : "";
    auditView.chatId = groupSelect.value;
  }
  auditView.verify = { page: 1, status: "", q: "" };
  auditView.log = { page: 1, action: "", q: "" };

  $("audit-stats").innerHTML = `
    <div class="card">
      <div class="stats">
        <div class="stat tone-primary">${svgIcon("check", 18)}<b>${Number(stats.approved || 0)}</b><span>已放行</span></div>
        <div class="stat tone-secondary">${svgIcon("clock", 18)}<b>${Number(stats.pending || 0)}</b><span>待验证</span></div>
        <div class="stat tone-tertiary">${svgIcon("stack", 18)}<b>${Number(stats.timeout || 0) + Number(stats.declined || 0)}</b><span>未通过</span></div>
      </div>
      <p class="chain">${chainBadge}</p>
    </div>`;

  $("audit-body").innerHTML = `
    <div class="card">
      <div class="table-head">
        <h2 class="md-typescale-title-medium">验证记录</h2>
        <span class="md-typescale-body-small muted" id="v-count"></span>
      </div>
      <div class="toolbar">
        <md-outlined-text-field id="v-q" label="搜索用户 / 记录 ID"></md-outlined-text-field>
        ${selectHtml("v-status", STATUS_OPTIONS)}
      </div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>时间</th><th>群</th><th>用户</th><th>状态</th><th>说明</th></tr></thead>
          <tbody id="v-rows"></tbody>
        </table>
      </div>
      <div class="pager" id="v-pager"></div>
    </div>
    <div class="card">
      <div class="table-head">
        <h2 class="md-typescale-title-medium">审计日志</h2>
        <span class="md-typescale-body-small muted" id="a-count"></span>
      </div>
      <div class="toolbar">
        <md-outlined-text-field id="a-q" label="搜索动作 / 用户 / 详情"></md-outlined-text-field>
        ${selectHtml("a-action", ACTION_OPTIONS)}
      </div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>时间</th><th>群</th><th>操作者</th><th>动作</th><th>详情</th></tr></thead>
          <tbody id="a-rows"></tbody>
        </table>
      </div>
      <div class="pager" id="a-pager"></div>
    </div>`;

  bindFilter("v", "verify", (value) => (auditView.verify.status = value), loadVerifyPage, "change");
  bindFilter("a", "log", (value) => (auditView.log.action = value), loadLogPage, "change");
  bindSearch("v-q", (value) => (auditView.verify.q = value), () => {
    auditView.verify.page = 1;
    loadVerifyPage();
  });
  bindSearch("a-q", (value) => (auditView.log.q = value), () => {
    auditView.log.page = 1;
    loadLogPage();
  });

  loadVerifyPage();
  loadLogPage();
}

function bindFilter(prefix, _key, apply, reload, event) {
  const el = $(`${prefix}-${prefix === "v" ? "status" : "action"}`);
  el?.addEventListener(event, () => {
    apply(el.value);
    auditView[prefix === "v" ? "verify" : "log"].page = 1;
    reload();
  });
}

function bindSearch(id, apply, reload) {
  const el = $(id);
  if (!el) return;
  let timer = 0;
  el.addEventListener("input", () => {
    clearTimeout(timer);
    timer = window.setTimeout(() => {
      apply(el.value.trim());
      reload();
    }, 300);
  });
}

async function downloadCsv() {
  const chatId = $("audit-group")?.value ?? "";
  try {
    const headers = tg?.initData
      ? { "X-Telegram-Init-Data": tg.initData }
      : state.token
        ? { Authorization: `Bearer ${state.token}` }
        : {};
    const query = chatId ? `?chatId=${encodeURIComponent(chatId)}` : "";
    const res = await fetch(`/api/audit/export.csv${query}`, { headers });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `paffbot-${chatId}.csv`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast("CSV 已开始下载");
  } catch (err) {
    $("audit-hint").textContent = `导出失败：${err.message}`;
  }
}

/* ---------------------------------------------------------------- 初始化 */

/** 审计只给管理员：Mini App 里 superAdmin，或网页端直接访问 /admin。 */
function applyNavVisibility() {
  const isAdmin = state.superAdmin || location.pathname === "/admin" || params.get("admin") === "1";
  const auditButton = $("nav").querySelector('button[data-view="audit"]');
  if (auditButton) auditButton.classList.toggle("hidden", !isAdmin);
  if (isAdmin && location.pathname === "/admin") switchTab("audit");
}

function switchTab(name) {
  $("view-verify").classList.toggle("hidden", name !== "verify");
  $("view-audit").classList.toggle("hidden", name !== "audit");
  for (const button of $("nav").querySelectorAll("button")) {
    button.setAttribute("aria-selected", String(button.dataset.view === name));
  }
  if (name === "audit") {
    if (!tg?.initData && !state.token) $("token-card").classList.remove("hidden");
    if (!state.auditLoaded) {
      state.auditLoaded = true;
      loadAudit();
    }
  }
}

$("empty-icon").innerHTML = svgIcon("inbox", 28);

/** 版权：起始年固定，跨年后自动变成区间。 */
function renderFooter() {
  const START_YEAR = 2026;
  const year = new Date().getFullYear();
  const range = year > START_YEAR ? `${START_YEAR} - ${year}` : `${START_YEAR}`;
  $("foot").innerHTML = `©️ ${range} <a href="https://bili33.top" target="_blank" rel="noreferrer">GamerNoTitle</a>`;
}
renderFooter();

/**
 * 正弦波路径：wavy progress 用。
 *
 * 路径要比视口宽出一个波长（左右各一段），这样动画 translateX(-波长) 时
 * 右端仍然覆盖到裁切边界，不会露出缺口、也不会在循环重启时「弹回去」。
 */
function wavePath(width = 100, height = 10, amplitude = 2.6, wavelength = 10) {
  const mid = height / 2;
  const start = -wavelength;
  const end = width + wavelength;
  let d = `M${start} ${mid}`;
  for (let x = start; x < end; x += wavelength / 2) {
    const up = Math.round((x - start) / (wavelength / 2)) % 2 === 0;
    d += ` Q${x + wavelength / 4} ${mid + (up ? -amplitude : amplitude)} ${x + wavelength / 2} ${mid}`;
  }
  return d;
}

function initWave() {
  const d = wavePath();
  $("wavy-track").setAttribute("d", d);
  $("wavy-bar").setAttribute("d", d);
}

/** Hero 右侧的抽象形状组合（不用位图）。 */
function renderHeroArt() {
  const art = $("hero-art");
  if (!art) return;

  const shape = (name, size, color, cls) =>
    `<div class="hero-shape ${cls}">${shapeSvg(name, { size, color })}</div>`;

  art.innerHTML = [
    shape("cookie9", 186, "color-mix(in srgb, var(--md-sys-color-primary) 88%, transparent)", "hero-shape--a"),
    shape("flower", 128, "var(--md-sys-color-tertiary-container)", "hero-shape--b"),
    shape("heart", 72, "color-mix(in srgb, var(--md-sys-color-primary) 55%, transparent)", "hero-shape--c"),
    shape("sunny", 62, "color-mix(in srgb, var(--md-sys-color-on-primary-container) 32%, transparent)", "hero-shape--d"),
  ].join("");

  // 进入视口才转，离开就停
  if (!("IntersectionObserver" in window)) {
    art.classList.add("is-visible");
    return;
  }
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) art.classList.toggle("is-visible", entry.isIntersecting);
    },
    { threshold: 0.15 },
  );
  observer.observe(art);
}

renderHeroArt();
initWave();

// 形状装饰：空态图标用 cookie9，成功弹窗用 flower
const root = document.documentElement;
root.style.setProperty("--shape-empty", shapeMask("cookie9"));
root.style.setProperty("--shape-success", shapeMask("flower"));

for (const button of $("nav").querySelectorAll("button")) {
  button.addEventListener("click", () => switchTab(button.dataset.view));
}
$("refresh").addEventListener("click", loadSession);
$("btn-standalone").addEventListener("click", () => enterStandalone());
$("dialog-close").addEventListener("click", () => $("success-dialog").close());
$("audit-group").addEventListener("change", () => {
  auditView.verify.page = 1;
  auditView.log.page = 1;
  loadAudit();
});
$("btn-audit-csv").addEventListener("click", downloadCsv);
$("btn-token").addEventListener("click", () => {
  state.token = $("admin-token").value.trim();
  localStorage.setItem("paffbot.token", state.token);
  $("token-card").classList.add("hidden");
  applyNavVisibility();
loadSession();
});

applyNavVisibility();
loadSession();
