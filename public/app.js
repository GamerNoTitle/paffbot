import { applyTheme, telegramSeed, DEFAULT_SEED } from "./vendor/material.js";

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

function setHero({ eyebrow, title, sub, chips = null }) {
  if (eyebrow !== undefined) $("hero-eyebrow").textContent = eyebrow;
  if (title !== undefined) $("hero-title").textContent = title;
  if (sub !== undefined) $("hero-sub").textContent = sub;
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

    if (!data.verification) {
      const name = data.user?.name?.split(" ")[0];
      setHero({
        eyebrow: "PAFFBOT · 入群验证",
        title: name ? `你好，${name}` : "暂无待验证",
        sub: "在群里点「申请加入」后，我会私聊你验证入口；也可以先看看审计。",
        chips: [],
      });
      showState("empty");
      return;
    }

    const v = data.verification;
    setHero({
      eyebrow: "PAFFBOT · 入群验证",
      title: "完成 GitHub 签名即可入群",
      sub: v.chatTitle ?? String(v.chatId),
      chips: [{ text: "剩余 05:00", id: "hero-countdown", strong: true }],
    });
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
      setHero({ eyebrow: "PAFFBOT", title: "出错了", sub: err.message, chips: [] });
    }
  }
}

async function loadPanel() {
  const panel = $("method-panel");
  panel.innerHTML = '<p class="md-typescale-body-medium muted">加载中…</p>';
  if (PREVIEW) {
    renderGithubPanel(panel, {
      challenge: state.challenge,
      requirements: { minAccountAgeDays: 0, requiredOrg: null },
    });
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
    renderGithubPanel(panel, data);
  } catch (err) {
    panel.innerHTML = `<p class="md-typescale-body-medium" style="color:var(--md-sys-color-error)">${esc(err.message)}</p>`;
  }
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
              <div class="code__tabs" id="gh-shells"></div>
              <md-icon-button id="gh-copy" aria-label="复制命令"><md-icon>${svgIcon("copy", 20)}</md-icon></md-icon-button>
            </div>
            <pre id="gh-cmd"></pre>
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
  for (const [id, label] of [
    ["bash", "Bash"],
    ["pwsh", "PowerShell"],
  ]) {
    const chip = document.createElement("md-filter-chip");
    chip.setAttribute("label", label);
    chip.dataset.shell = id;
    chip.selected = state.shell === id;
    chip.addEventListener("click", () => {
      state.shell = id;
      for (const other of shells.querySelectorAll("md-filter-chip")) other.selected = other.dataset.shell === id;
      $("gh-cmd").textContent = githubCommand(id);
    });
    shells.appendChild(chip);
  }
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
    eyebrow: "PAFFBOT",
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
      eyebrow: "PAFFBOT",
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
  const tick = () => {
    const left = Math.max(0, expiresAt - Date.now());
    const total = Math.floor(left / 1000);
    const text =
      left > 0
        ? `剩余 ${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`
        : "已过期";
    const chip = $("hero-countdown");
    if (chip) chip.textContent = text;
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
    eyebrow: "PAFFBOT · 入群验证",
    title: "完成 GitHub 签名即可入群",
    sub: "示例群 · Paff 测试群",
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
  startCountdown(state.verification.expiresAt);
  loadPanel();
}

/* ---------------------------------------------------------------- 审计 */

async function loadAudit() {
  const chatId = $("audit-chat").value.trim();
  if (!chatId) {
    $("audit-hint").textContent = "请先填写群组 ID（群里发 /id 可以看到）。";
    return;
  }
  localStorage.setItem("paffbot.chat", chatId);
  $("audit-hint").textContent = "查询中…";
  try {
    const data = await api(`/api/audit/overview?chatId=${encodeURIComponent(chatId)}`);
    $("audit-hint").textContent = `共 ${data.verificationsTotal} 条验证、${data.auditTotal} 条审计。`;
    renderAudit(data);
    $("token-card").classList.add("hidden");
  } catch (err) {
    $("audit-hint").textContent = `查询失败：${err.message}`;
    if (err.status === 401) $("token-card").classList.remove("hidden");
  }
}

const STATUS_META = {
  approved: { label: "已放行", tone: "tone-primary" },
  pending: { label: "待验证", tone: "tone-secondary" },
  timeout: { label: "超时", tone: "tone-tertiary" },
  declined: { label: "已拒绝", tone: "tone-tertiary" },
  banned: { label: "已封禁", tone: "tone-error" },
  blocked: { label: "自动拦截", tone: "tone-error" },
};

function fmtTime(ts) {
  const d = new Date(ts + 8 * 3600 * 1000);
  const p = (n) => String(n).padStart(2, "0");
  return `${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
}

/** 状态已经说明了方式时不再重复一行 */
function methodNote(row) {
  const method = row.method;
  if (!method || method === row.status || method === "profile") return "";
  return `<span class="cell-sub">${esc(method)}</span>`;
}

function renderAudit(data) {
  const stats = data.stats || {};
  const chain = data.chain || { ok: true, checked: 0 };
  const chainBadge = chain.ok
    ? `<span class="badge ok">哈希链完整 · ${chain.checked}</span>`
    : `<span class="badge bad">哈希链在 #${chain.brokenAtId} 断开</span>`;

  $("audit-stats").innerHTML = `
    <div class="card">
      <div class="stats">
        <div class="stat tone-primary">${svgIcon("check", 18)}<b>${Number(stats.approved || 0)}</b><span>已放行</span></div>
        <div class="stat tone-secondary">${svgIcon("clock", 18)}<b>${Number(stats.pending || 0)}</b><span>待验证</span></div>
        <div class="stat tone-tertiary">${svgIcon("stack", 18)}<b>${Number(stats.timeout || 0) + Number(stats.declined || 0)}</b><span>未通过</span></div>
      </div>
      <p class="chain">${chainBadge}</p>
    </div>`;

  const verificationRows = (data.verifications || [])
    .map((row) => {
      const meta = STATUS_META[row.status] ?? { label: row.status, tone: "" };
      return `<tr>
        <td data-label="时间"><div class="cell mono">${fmtTime(row.createdAt)}</div></td>
        <td data-label="用户"><div class="cell">${esc(row.userName || row.userId)}<span class="cell-sub mono">${esc(row.userId)}</span></div></td>
        <td data-label="状态"><div class="cell"><span class="status-chip ${meta.tone}">${esc(meta.label)}</span>${methodNote(row)}</div></td>
        <td data-label="原因" class="muted"><div class="cell">${esc(row.reason || "")}${
          row.operatorId ? `<span class="cell-sub">by ${esc(row.operatorId)}</span>` : ""
        }</div></td>
      </tr>`;
    })
    .join("");

  const auditRows = (data.audit || [])
    .map(
      (row) => `<tr>
        <td data-label="时间"><div class="cell mono">${fmtTime(row.ts)}</div></td>
        <td data-label="操作者"><div class="cell">${esc(row.actorType)}<span class="cell-sub mono">${esc(row.actorId)}</span></div></td>
        <td data-label="动作"><div class="cell">${esc(row.action)}</div></td>
        <td data-label="目标" class="muted"><div class="cell">${esc(row.targetUserId || "")}${
          row.detail ? `<span class="cell-sub">${esc(JSON.stringify(row.detail).slice(0, 70))}</span>` : ""
        }</div></td>
      </tr>`,
    )
    .join("");

  $("audit-body").innerHTML = `
    <div class="card">
      <div class="table-head">
        <h2 class="md-typescale-title-medium">验证记录</h2>
        <span class="md-typescale-body-small muted">${data.verificationsTotal ?? 0} 条</span>
      </div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>时间</th><th>用户</th><th>状态</th><th>原因 / 操作者</th></tr></thead>
          <tbody>${verificationRows || '<tr><td colspan="4" class="muted">暂无记录</td></tr>'}</tbody>
        </table>
      </div>
    </div>
    <div class="card">
      <div class="table-head">
        <h2 class="md-typescale-title-medium">审计日志</h2>
        <span class="md-typescale-body-small muted">${data.auditTotal ?? 0} 条</span>
      </div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>时间</th><th>操作者</th><th>动作</th><th>目标 / 详情</th></tr></thead>
          <tbody>${auditRows || '<tr><td colspan="4" class="muted">暂无记录</td></tr>'}</tbody>
        </table>
      </div>
    </div>`;
}

async function downloadCsv() {
  const chatId = $("audit-chat").value.trim();
  if (!chatId) return;
  try {
    const headers = tg?.initData
      ? { "X-Telegram-Init-Data": tg.initData }
      : state.token
        ? { Authorization: `Bearer ${state.token}` }
        : {};
    const res = await fetch(`/api/audit/export.csv?chatId=${encodeURIComponent(chatId)}`, { headers });
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

function switchTab(name) {
  $("view-verify").classList.toggle("hidden", name !== "verify");
  $("view-audit").classList.toggle("hidden", name !== "audit");
  if (name === "audit") {
    if (!tg?.initData && !state.token) $("token-card").classList.remove("hidden");
    if (!$("audit-chat").value) {
      const fromUrl = new URLSearchParams(location.search).get("chat");
      $("audit-chat").value = fromUrl || localStorage.getItem("paffbot.chat") || "";
    }
  }
}

$("tab-verify-icon").innerHTML = svgIcon("shield", 20);
$("tab-audit-icon").innerHTML = svgIcon("list", 20);
$("empty-icon").innerHTML = svgIcon("inbox", 28);

$("tab-verify").addEventListener("click", () => switchTab("verify"));
$("tab-audit").addEventListener("click", () => switchTab("audit"));
$("refresh").addEventListener("click", loadSession);
$("btn-standalone").addEventListener("click", () => enterStandalone());
$("dialog-close").addEventListener("click", () => $("success-dialog").close());
$("btn-audit-load").addEventListener("click", loadAudit);
$("btn-audit-csv").addEventListener("click", downloadCsv);
$("btn-token").addEventListener("click", () => {
  state.token = $("admin-token").value.trim();
  localStorage.setItem("paffbot.token", state.token);
  $("token-card").classList.add("hidden");
  loadSession();
});

loadSession();
