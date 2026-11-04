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
  inbox:
    '<path d="M19 3H5a2 2 0 0 0-2 2v14l4-4h12a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2Zm0 12H6.17L5 16.17V5h14v10Z"/>',
  copy: '<path d="M16 1H4a2 2 0 0 0-2 2v14h2V3h12V1Zm3 4H8a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2Zm0 16H8V7h11v14Z"/>',
  error: '<path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm1 15h-2v-2h2v2Zm0-4h-2V7h2v6Z"/>',
};

function svgIcon(name, size = 22) {
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

function paintTheme() {
  applyTheme({ seed, dark });
  $("theme-icon").innerHTML = svgIcon(dark ? "light" : "dark");
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

const state = {
  session: null,
  verification: null,
  activeMethod: null,
  challenge: "",
  shell: "bash",
  timer: 0,
  token: localStorage.getItem("paffbot.token") || "",
};

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

/* ---------------------------------------------------------------- 会话 */

async function loadSession() {
  if (PREVIEW) {
    renderPreview();
    return;
  }
  try {
    const data = await api("/api/session");
    state.session = data;
    state.verification = data.verification;
    $("whoami").textContent = data.user?.name ? `已识别：${data.user.name}` : "入群验证";
    $("loading").classList.add("hidden");

    if (!data.verification) {
      $("empty").classList.remove("hidden");
      $("pending").classList.add("hidden");
      return;
    }

    $("empty").classList.add("hidden");
    $("success").classList.add("hidden");
    $("pending").classList.remove("hidden");
    $("chat-title").textContent = data.verification.chatTitle || String(data.verification.chatId);

    renderMethodChips(data.methods);
    startCountdown(data.verification.expiresAt);
    await selectMethod(state.activeMethod || data.methods[0]?.id);
  } catch (err) {
    if (err.status === 401 && !tg?.initData) {
      $("loading").classList.add("hidden");
      const empty = $("empty");
      empty.classList.remove("hidden");
      empty.querySelector("h2").textContent = "请在 Telegram 内打开";
      empty.querySelector("p").textContent =
        "验证页需要 Telegram 的 initData 来识别账号。从 @P4ffBot 的验证按钮进入即可，也可以先看界面预览或审计。";
      $("refresh").textContent = "界面预览";
      $("refresh").addEventListener("click", () => (location.search = "?preview=1"), { once: true });
      $("token-card").classList.remove("hidden");
    } else {
      $("loading").innerHTML = `<p class="md-typescale-body-medium">加载失败：${esc(err.message)}</p>`;
    }
  }
}

function renderMethodChips(methods) {
  const box = $("method-chips");
  box.innerHTML = "";
  if (methods.length <= 1) return;
  for (const method of methods) {
    const chip = document.createElement("md-filter-chip");
    chip.setAttribute("label", method.label);
    chip.dataset.method = method.id;
    chip.selected = method.id === state.activeMethod;
    chip.addEventListener("click", () => selectMethod(method.id));
    box.appendChild(chip);
  }
}

async function selectMethod(methodId) {
  if (!methodId) return;
  state.activeMethod = methodId;
  if (PREVIEW) {
    for (const chip of $("method-chips").querySelectorAll("md-filter-chip")) {
      chip.selected = chip.dataset.method === methodId;
    }
    renderPreviewPanel(methodId);
    return;
  }
  for (const chip of $("method-chips").querySelectorAll("md-filter-chip")) {
    chip.selected = chip.dataset.method === methodId;
  }

  const panel = $("method-panel");
  panel.innerHTML = '<p class="md-typescale-body-medium muted">加载验证方式…</p>';
  try {
    const data = await api(
      `/api/verify/start?method=${encodeURIComponent(methodId)}&verificationId=${encodeURIComponent(state.verification.id)}`,
    );
    state.challenge = data.challenge || "";
    if (methodId === "github") renderGithubPanel(panel, data);
    else if (methodId === "ssh") renderSshPanel(panel, data);
    else if (methodId === "quiz") renderQuizPanel(panel, data);
    else renderButtonPanel(panel, data);
  } catch (err) {
    panel.innerHTML = `<p class="error-text">${esc(err.message)}</p>`;
  }
}

/* ---------------------------------------------------------------- GitHub SSH */

function githubCommand(shell) {
  return shell === "pwsh"
    ? `"${state.challenge}" | ssh-keygen -Y sign -f $HOME/.ssh/id_ed25519 -n file -`
    : `echo "${state.challenge}" | ssh-keygen -Y sign -f ~/.ssh/id_ed25519 -n file -`;
}

function renderGithubPanel(panel, data) {
  const requirements = data.requirements || {};
  const notes = [];
  if (requirements.minAccountAgeDays > 0) notes.push(`账号需注册满 ${requirements.minAccountAgeDays} 天`);
  if (requirements.requiredOrg) notes.push(`需属于组织 ${requirements.requiredOrg}`);

  panel.innerHTML = `
    <div class="panel-head">
      <h2 class="md-typescale-headline-small">GitHub SSH 验证</h2>
      <p class="md-typescale-body-medium muted">
        用已添加到 GitHub 账号的 SSH 私钥签名，不需要 OAuth，也不会读取你的私有数据。
        <a href="${GITHUB_SSH_DOC}" target="_blank" rel="noreferrer">SSH 配置指南</a>
      </p>
      ${notes.length ? `<p class="md-typescale-body-small muted">额外要求：${esc(notes.join("；"))}</p>` : ""}
    </div>

    <ol class="steps">
      <li class="step">
        <div class="step__head"><span class="step__num">1</span><h3 class="md-typescale-title-small">输入 GitHub 用户名</h3></div>
        <md-outlined-text-field
          id="gh-username"
          label="GitHub 用户名"
          supporting-text="不带 @，例如 octocat"
        ></md-outlined-text-field>
      </li>

      <li class="step">
        <div class="step__head"><span class="step__num">2</span><h3 class="md-typescale-title-small">执行签名命令</h3></div>
        <p class="md-typescale-body-small muted">在本机终端运行，私钥路径换成你自己的。</p>
        <div class="code">
          <div class="code__head">
            <div class="code__tabs" id="gh-shells"></div>
            <md-text-button id="gh-copy"><md-icon slot="icon">${svgIcon("copy", 18)}</md-icon>复制</md-text-button>
          </div>
          <pre id="gh-cmd"></pre>
        </div>
      </li>

      <li class="step">
        <div class="step__head"><span class="step__num">3</span><h3 class="md-typescale-title-small">粘贴签名结果</h3></div>
        <md-outlined-text-field
          id="gh-signature"
          type="textarea"
          rows="5"
          label="SSH 签名"
          supporting-text="以 -----BEGIN SSH SIGNATURE----- 开头"
        ></md-outlined-text-field>
      </li>
    </ol>

    <div class="panel-actions">
      <md-filled-button id="gh-submit" disabled>验证签名</md-filled-button>
    </div>
    <p class="error-text hidden" id="gh-error"></p>
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
    submit.textContent = "验证中…";
    $("gh-error").classList.add("hidden");
    try {
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
      submit.textContent = "验证签名";
    }
  });
}

/* ---------------------------------------------------------------- 自有公钥 */

function renderSshPanel(panel, data) {
  panel.innerHTML = `
    <div class="panel-head">
      <h2 class="md-typescale-headline-small">SSH 公钥签名</h2>
      <p class="md-typescale-body-medium muted">用你登记过的公钥对挑战串签名，签名只对本次验证有效。</p>
    </div>
    <ol class="steps">
      <li class="step">
        <div class="step__head"><span class="step__num">1</span><h3 class="md-typescale-title-small">挑战串</h3></div>
        <md-outlined-text-field id="ssh-challenge" readonly label="挑战串"></md-outlined-text-field>
      </li>
      <li class="step">
        <div class="step__head"><span class="step__num">2</span><h3 class="md-typescale-title-small">粘贴签名</h3></div>
        <md-outlined-text-field id="ssh-signature" type="textarea" rows="5" label="SSH 签名"></md-outlined-text-field>
      </li>
    </ol>
    <div class="panel-actions"><md-filled-button id="ssh-submit">提交签名</md-filled-button></div>
    <p class="error-text hidden" id="ssh-error"></p>
    <div class="step">
      <div class="step__head"><span class="step__num">+</span><h3 class="md-typescale-title-small">已登记的公钥</h3></div>
      <div id="ssh-keys"></div>
      <md-outlined-text-field id="ssh-pubkey" type="textarea" rows="2" label="粘贴新公钥" supporting-text="cat ~/.ssh/id_ed25519.pub"></md-outlined-text-field>
      <div class="panel-actions"><md-outlined-button id="ssh-save">保存公钥</md-outlined-button></div>
    </div>
  `;

  $("ssh-challenge").value = data.challenge || "";
  renderKeys($("ssh-keys"), data.keys || []);

  $("ssh-save").addEventListener("click", async () => {
    const publicKey = $("ssh-pubkey").value.trim();
    if (!publicKey) return;
    try {
      await api("/api/verify/ssh/keys", { method: "POST", body: JSON.stringify({ publicKey }) });
      toast("公钥已登记");
      await selectMethod("ssh");
    } catch (err) {
      toast(err.message);
    }
  });

  $("ssh-submit").addEventListener("click", async () => {
    const signature = $("ssh-signature").value.trim();
    if (!signature) return;
    const button = $("ssh-submit");
    button.disabled = true;
    button.textContent = "校验中…";
    try {
      const result = await api("/api/verify/submit", {
        method: "POST",
        body: JSON.stringify({ method: "ssh", verificationId: state.verification.id, signature }),
      });
      onApproved(result);
    } catch (err) {
      $("ssh-error").textContent = err.message;
      $("ssh-error").classList.remove("hidden");
      button.disabled = false;
      button.textContent = "提交签名";
    }
  });
}

function renderKeys(container, keys) {
  container.innerHTML = "";
  if (!keys.length) {
    container.innerHTML = '<p class="md-typescale-body-small muted">还没有登记公钥。</p>';
    return;
  }
  for (const key of keys) {
    const row = document.createElement("div");
    row.style.cssText =
      "display:flex;gap:10px;align-items:center;justify-content:space-between;padding:8px 0;border-top:1px solid var(--md-sys-color-outline-variant)";
    row.innerHTML = `<div><div class="mono">${esc(key.fingerprint)}</div>
      <div class="md-typescale-body-small muted">${esc(key.label || key.keyType)}</div></div>`;
    const remove = document.createElement("md-text-button");
    remove.textContent = "删除";
    remove.addEventListener("click", async () => {
      try {
        await api("/api/verify/ssh/keys/delete", {
          method: "POST",
          body: JSON.stringify({ fingerprint: key.fingerprint }),
        });
        await selectMethod("ssh");
      } catch (err) {
        toast(err.message);
      }
    });
    row.appendChild(remove);
    container.appendChild(row);
  }
}

/* ---------------------------------------------------------------- 答题 / 按钮 */

function renderQuizPanel(panel, data) {
  panel.innerHTML = `
    <div class="panel-head">
      <h2 class="md-typescale-headline-small">答题验证</h2>
      <p class="md-typescale-body-medium muted">${esc(data.note || "")}</p>
    </div>
    <div id="quiz-form"></div>
    <div class="panel-actions"><md-filled-button id="quiz-submit">提交答案</md-filled-button></div>
    <p class="error-text hidden" id="quiz-error"></p>
  `;

  const form = $("quiz-form");
  (data.questions || []).forEach((question, index) => {
    const block = document.createElement("div");
    block.className = "question";
    block.innerHTML = `<p class="md-typescale-title-small">${index + 1}. ${esc(question.question)}</p>`;
    question.options.forEach((option, optionIndex) => {
      const label = document.createElement("label");
      label.className = "option";
      label.innerHTML = `<md-radio name="q${index}" value="${optionIndex}"></md-radio><span class="md-typescale-body-medium">${esc(option)}</span>`;
      label.addEventListener("click", () => {
        const radio = label.querySelector("md-radio");
        radio.checked = true;
      });
      block.appendChild(label);
    });
    form.appendChild(block);
  });

  $("quiz-submit").addEventListener("click", async () => {
    const answers = (data.questions || []).map((_, index) => {
      const checked = form.querySelector(`md-radio[name="q${index}"][checked]`);
      return checked ? Number(checked.getAttribute("value")) : -1;
    });
    if (answers.some((answer) => answer < 0)) {
      $("quiz-error").textContent = "还有题没答。";
      $("quiz-error").classList.remove("hidden");
      return;
    }
    const button = $("quiz-submit");
    button.disabled = true;
    button.textContent = "判分中…";
    try {
      const result = await api("/api/verify/submit", {
        method: "POST",
        body: JSON.stringify({ method: "quiz", verificationId: state.verification.id, answers }),
      });
      onApproved(result);
    } catch (err) {
      $("quiz-error").textContent = err.message;
      $("quiz-error").classList.remove("hidden");
      button.disabled = false;
      button.textContent = "提交答案";
    }
  });
}

function renderButtonPanel(panel, data) {
  panel.innerHTML = `
    <div class="panel-head">
      <h2 class="md-typescale-headline-small">一键确认</h2>
      <p class="md-typescale-body-medium muted">${esc(data.note || "点一下确认你是真人")}</p>
    </div>
    <div class="panel-actions"><md-filled-button id="button-submit">我是真人，放行</md-filled-button></div>
    <p class="error-text hidden" id="button-error"></p>
  `;
  $("button-submit").addEventListener("click", async () => {
    const button = $("button-submit");
    button.disabled = true;
    button.textContent = "处理中…";
    try {
      const result = await api("/api/verify/submit", {
        method: "POST",
        body: JSON.stringify({ method: "button", verificationId: state.verification.id }),
      });
      onApproved(result);
    } catch (err) {
      $("button-error").textContent = err.message;
      $("button-error").classList.remove("hidden");
      button.disabled = false;
      button.textContent = "我是真人，放行";
    }
  });
}

/* ---------------------------------------------------------------- 状态 */

function onApproved(result) {
  clearInterval(state.timer);
  $("pending").classList.add("hidden");
  $("success").classList.remove("hidden");
  $("success-icon").innerHTML = svgIcon("check", 26);
  $("success-text").textContent = `已放行你加入「${result.chatTitle || "群组"}」，可以回到群聊了。`;
  try {
    tg?.HapticFeedback?.notificationOccurred("success");
  } catch {}
}

function startCountdown(expiresAt) {
  clearInterval(state.timer);
  const el = $("countdown");
  const tick = () => {
    const left = Math.max(0, expiresAt - Date.now());
    const total = Math.floor(left / 1000);
    el.textContent =
      left > 0
        ? `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`
        : "已过期";
    if (left === 0) {
      clearInterval(state.timer);
      $("method-panel").innerHTML =
        '<p class="md-typescale-body-medium muted">这次验证已超时，请回群里重新申请。</p>';
    }
  };
  tick();
  state.timer = window.setInterval(tick, 1000);
}

/* ---------------------------------------------------------------- 预览 */

function renderPreviewPanel(methodId) {
  if (methodId === "github") {
    renderGithubPanel($("method-panel"), {
      challenge: state.challenge,
      requirements: { minAccountAgeDays: 0, requiredOrg: null },
    });
    const button = $("gh-submit");
    button.disabled = true;
    button.textContent = "预览模式（不可提交）";
    return;
  }
  const label = methodId === "quiz" ? "答题验证" : "一键确认";
  $("method-panel").innerHTML = `
    <div class="panel-head">
      <h2 class="md-typescale-headline-small">${label}</h2>
      <p class="md-typescale-body-medium muted">预览模式只渲染 GitHub 面板作为样例；真实环境会加载这项验证的交互。</p>
    </div>`;
}

function renderPreview() {
  $("loading").classList.add("hidden");
  $("empty").classList.add("hidden");
  $("pending").classList.remove("hidden");

  const banner = document.createElement("div");
  banner.className = "preview-banner";
  banner.innerHTML = `<md-icon>${svgIcon("error", 20)}</md-icon><span>界面预览：示例数据，不会真正提交。真实验证请在 Telegram 里从 @P4ffBot 打开。</span>`;
  $("pending").prepend(banner);

  state.verification = {
    id: "preview",
    chatId: -1001234567890,
    chatTitle: "示例群 · Paff 测试群",
    status: "pending",
    expiresAt: Date.now() + 300_000,
  };
  $("chat-title").textContent = state.verification.chatTitle;
  startCountdown(state.verification.expiresAt);

  state.challenge = "paffbot-verify:v1:preview-demo:8f3a1c2b";
  renderMethodChips([
    { id: "github", label: "GitHub SSH" },
    { id: "quiz", label: "答题" },
    { id: "button", label: "一键确认" },
  ]);
  selectMethod("github");
}

/* ---------------------------------------------------------------- 审计 */

async function loadAudit() {
  const chatId = $("audit-chat").value.trim();
  if (!chatId) {
    $("audit-hint").textContent = "请先填写群组 ID（群里发 /id 可以看到）。";
    return;
  }
  state.auditChat = chatId;
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

function renderAudit(data) {
  const labels = {
    pending: "待验证",
    approved: "已放行",
    declined: "已拒绝",
    timeout: "超时",
    banned: "已封禁",
    blocked: "自动拦截",
  };
  const stats = data.stats || {};
  const statCards = Object.entries(labels)
    .map(([key, label]) => `<div class="stat"><b>${Number(stats[key] || 0)}</b><span>${label}</span></div>`)
    .join("");

  const chain = data.chain || { ok: true, checked: 0 };
  const chainBadge = chain.ok
    ? `<span class="badge ok">哈希链完整 · ${chain.checked} 条</span>`
    : `<span class="badge bad">哈希链在 #${chain.brokenAtId} 断开</span>`;

  const verificationRows = (data.verifications || [])
    .map(
      (row) => `<tr>
        <td class="mono">${esc(new Date(row.createdAt).toLocaleString())}</td>
        <td>${esc(row.userName || row.userId)}<br /><span class="md-typescale-body-small muted mono">${esc(row.userId)}</span></td>
        <td>${esc(labels[row.status] || row.status)}${row.method ? `<br /><span class="md-typescale-body-small muted">${esc(row.method)}</span>` : ""}</td>
        <td>${esc(row.reason || "")}${row.operatorId ? `<br /><span class="md-typescale-body-small muted">by ${esc(row.operatorId)}</span>` : ""}</td>
      </tr>`,
    )
    .join("");

  const auditRows = (data.audit || [])
    .map(
      (row) => `<tr>
        <td class="mono">${esc(new Date(row.ts).toLocaleString())}</td>
        <td>${esc(row.actorType)}<br /><span class="md-typescale-body-small muted mono">${esc(row.actorId)}</span></td>
        <td>${esc(row.action)}</td>
        <td class="wrap">${esc(row.targetUserId || "")}${
          row.detail
            ? `<br /><span class="md-typescale-body-small muted">${esc(JSON.stringify(row.detail).slice(0, 120))}</span>`
            : ""
        }</td>
      </tr>`,
    )
    .join("");

  $("audit-body").innerHTML = `
    <div class="card">
      <div class="stats">${statCards}</div>
      <p style="margin:12px 0 0">${chainBadge}</p>
    </div>
    <div class="card">
      <h2 class="md-typescale-title-medium">验证记录</h2>
      <table><thead><tr><th>时间</th><th>用户</th><th>状态</th><th>原因 / 操作者</th></tr></thead>
      <tbody>${verificationRows || '<tr><td colspan="4" class="muted">暂无记录</td></tr>'}</tbody></table>
    </div>
    <div class="card">
      <h2 class="md-typescale-title-medium">审计日志</h2>
      <table><thead><tr><th>时间</th><th>操作者</th><th>动作</th><th>目标 / 详情</th></tr></thead>
      <tbody>${auditRows || '<tr><td colspan="4" class="muted">暂无记录</td></tr>'}</tbody></table>
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

$("tab-verify").addEventListener("click", () => switchTab("verify"));
$("tab-audit").addEventListener("click", () => switchTab("audit"));

$("refresh").addEventListener("click", loadSession);
$("close").addEventListener("click", () => tg?.close?.());
$("btn-audit-load").addEventListener("click", loadAudit);
$("btn-audit-csv").addEventListener("click", downloadCsv);
$("btn-token").addEventListener("click", () => {
  state.token = $("admin-token").value.trim();
  localStorage.setItem("paffbot.token", state.token);
  $("token-card").classList.add("hidden");
  loadSession();
});

$("empty-icon").innerHTML = svgIcon("inbox", 26);

loadSession();
