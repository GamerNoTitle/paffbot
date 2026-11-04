/* paffbot Mini App —— 无框架，直接操作 DOM。 */

const tg = window.Telegram?.WebApp;
const GITHUB_SSH_DOC =
  "https://docs.github.com/zh/authentication/connecting-to-github-with-ssh/generating-a-new-ssh-key-and-adding-it-to-the-ssh-agent";

const state = {
  session: null,
  verification: null,
  activeMethod: null,
  challenge: "",
  shell: "bash",
  timer: null,
  token: localStorage.getItem("paffbot.token") || "",
  auditChat: "",
};

const $ = (id) => document.getElementById(id);
const esc = (value) =>
  String(value ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);

if (tg) {
  tg.ready();
  tg.expand();
  try {
    tg.setHeaderColor?.("#f8fafc");
    tg.setBackgroundColor?.("#f8fafc");
  } catch {}
}

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

// ------------------------------------------------------------------ 会话

async function loadSession() {
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
    $("loading").textContent = `加载失败：${err.message}`;
    if (err.status === 401 && !tg?.initData) $("token-card").classList.remove("hidden");
  }
}

function renderMethodChips(methods) {
  const box = $("method-chips");
  box.innerHTML = "";
  if (methods.length <= 1) return;
  for (const method of methods) {
    const button = document.createElement("button");
    button.className = "chip";
    button.textContent = method.label;
    button.dataset.method = method.id;
    button.addEventListener("click", () => selectMethod(method.id));
    box.appendChild(button);
  }
}

async function selectMethod(methodId) {
  if (!methodId) return;
  state.activeMethod = methodId;
  for (const chip of document.querySelectorAll("#method-chips .chip")) {
    chip.classList.toggle("active", chip.dataset.method === methodId);
  }

  const panel = $("method-panel");
  panel.innerHTML = '<p class="help">加载验证方式…</p>';
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
    panel.innerHTML = `<p class="error">${esc(err.message)}</p>`;
  }
}

// ------------------------------------------------------------------ GitHub SSH

function githubCommand(shell) {
  const challenge = state.challenge;
  return shell === "pwsh"
    ? `"${challenge}" | ssh-keygen -Y sign -f $HOME/.ssh/id_ed25519 -n file -`
    : `echo "${challenge}" | ssh-keygen -Y sign -f ~/.ssh/id_ed25519 -n file -`;
}

function renderGithubPanel(panel, data) {
  panel.innerHTML = `
    <h1 class="panel-title">GitHub SSH 验证</h1>
    <p class="help">
      前提须知：建议先完成
      <a href="${GITHUB_SSH_DOC}" target="_blank" rel="noreferrer">SSH 环境配置</a>，
      再执行下面的签名验证步骤。
    </p>
    <p class="help" id="gh-req"></p>

    <div class="step">
      <div class="step-head"><span class="num">1</span><h2>输入 GitHub 用户名</h2></div>
      <p class="help">填写你的 GitHub 用户名（不带 @）。</p>
      <input id="gh-username" type="text" autocomplete="username" placeholder="GitHub username" />
    </div>

    <div class="step">
      <div class="step-head"><span class="num">2</span><h2>执行签名命令</h2></div>
      <p class="help">在本机终端运行以下命令对随机内容签名，需要将私钥路径替换为真实路径。</p>
      <div class="code">
        <div class="code-head">
          <div class="code-tabs">
            <button class="code-tab active" data-shell="bash">Bash</button>
            <button class="code-tab" data-shell="pwsh">PowerShell</button>
          </div>
          <button class="copy" id="gh-copy">复制</button>
        </div>
        <pre id="gh-cmd"></pre>
      </div>
    </div>

    <div class="step">
      <div class="step-head"><span class="num">3</span><h2>粘贴签名结果</h2></div>
      <p class="help">把完整签名文本粘贴到下方文本框。</p>
      <textarea id="gh-signature" rows="4" placeholder="-----BEGIN SSH SIGNATURE-----"></textarea>
    </div>

    <button class="primary" id="gh-submit" disabled>验证签名</button>
    <p class="error hidden" id="gh-error"></p>
  `;

  const requirements = data.requirements || {};
  const notes = [];
  if (requirements.minAccountAgeDays > 0) notes.push(`GitHub 账号需注册满 ${requirements.minAccountAgeDays} 天`);
  if (requirements.requiredOrg) notes.push(`需属于组织 ${requirements.requiredOrg}`);
  $("gh-req").textContent = notes.length ? `额外要求：${notes.join("；")}` : "";
  $("gh-req").classList.toggle("hidden", notes.length === 0);

  const command = () => ($("gh-cmd").textContent = githubCommand(state.shell));
  command();

  for (const tab of panel.querySelectorAll(".code-tab")) {
    tab.addEventListener("click", () => {
      state.shell = tab.dataset.shell;
      for (const other of panel.querySelectorAll(".code-tab")) other.classList.toggle("active", other === tab);
      command();
    });
  }

  $("gh-copy").addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(githubCommand(state.shell));
      $("gh-copy").textContent = "已复制";
      setTimeout(() => ($("gh-copy").textContent = "复制"), 1500);
    } catch {
      showPanelError("复制失败，请手动选中命令。");
    }
  });

  const usernameInput = $("gh-username");
  const signatureInput = $("gh-signature");
  const submit = $("gh-submit");

  const refreshState = () => {
    const username = usernameInput.value.trim().replace(/^@/, "");
    const signatureOk = signatureInput.value.includes("BEGIN SSH SIGNATURE");
    const usernameOk = /^[a-z\d](?:[a-z\d-]{0,37}[a-z\d])?$/i.test(username);
    usernameInput.classList.toggle("invalid", username.length > 0 && !usernameOk);
    signatureInput.classList.toggle("invalid", signatureInput.value.trim().length > 0 && !signatureOk);
    submit.disabled = !(usernameOk && signatureOk);
  };
  usernameInput.addEventListener("input", refreshState);
  signatureInput.addEventListener("input", refreshState);

  submit.addEventListener("click", async () => {
    submit.disabled = true;
    submit.textContent = "验证中…";
    hidePanelError();
    try {
      const result = await api("/api/verify/submit", {
        method: "POST",
        body: JSON.stringify({
          method: "github",
          verificationId: state.verification.id,
          username: usernameInput.value.trim(),
          signature: signatureInput.value.trim(),
        }),
      });
      onApproved(result);
    } catch (err) {
      showPanelError(err.message);
      submit.disabled = false;
      submit.textContent = "验证签名";
    }
  });
}

function showPanelError(message) {
  const box = $("gh-error") || document.querySelector("#method-panel .error");
  if (!box) return;
  box.textContent = message;
  box.classList.remove("hidden");
}

function hidePanelError() {
  const box = $("gh-error");
  if (box) box.classList.add("hidden");
}

// ------------------------------------------------------------------ 自有 SSH 公钥

function renderSshPanel(panel, data) {
  panel.innerHTML = `
    <h1 class="panel-title">SSH 公钥签名</h1>
    <p class="help">用你登记过的公钥对挑战串签名。签名只对本次验证有效。</p>
    <div class="step">
      <div class="step-head"><span class="num">1</span><h2>挑战串</h2></div>
      <p class="help">原样写入文件，不要加换行。</p>
      <div class="code"><pre id="ssh-challenge"></pre></div>
    </div>
    <div class="step">
      <div class="step-head"><span class="num">2</span><h2>签名</h2></div>
      <p class="help">printf '%s' '&lt;挑战串&gt;' &gt; msg.txt && ssh-keygen -Y sign -n paffbot -f ~/.ssh/id_ed25519 msg.txt</p>
      <textarea id="ssh-signature" rows="4" placeholder="-----BEGIN SSH SIGNATURE-----"></textarea>
    </div>
    <button class="primary" id="ssh-submit">提交签名</button>
    <p class="error hidden" id="ssh-error"></p>
    <div class="step">
      <div class="step-head"><span class="num">+</span><h2>管理已登记公钥</h2></div>
      <div id="ssh-keys"></div>
      <label class="field" style="margin-top:10px"><span>粘贴新公钥（cat ~/.ssh/id_ed25519.pub）</span>
        <textarea id="ssh-pubkey" rows="2" placeholder="ssh-ed25519 AAAAC3Nza..."></textarea>
      </label>
      <button class="ghost" id="ssh-save">保存公钥</button>
    </div>
  `;

  $("ssh-challenge").textContent = data.challenge || "";
  renderKeys($("ssh-keys"), data.keys || []);

  $("ssh-save").addEventListener("click", async () => {
    const publicKey = $("ssh-pubkey").value.trim();
    if (!publicKey) return;
    try {
      await api("/api/verify/ssh/keys", { method: "POST", body: JSON.stringify({ publicKey }) });
      await selectMethod("ssh");
    } catch (err) {
      $("ssh-error").textContent = err.message;
      $("ssh-error").classList.remove("hidden");
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
    container.innerHTML = '<p class="help">还没有登记公钥。</p>';
    return;
  }
  for (const key of keys) {
    const item = document.createElement("div");
    item.style.cssText = "display:flex;justify-content:space-between;gap:10px;padding:8px 0;border-top:1px solid var(--line)";
    item.innerHTML = `<div><div class="mono">${esc(key.fingerprint)}</div><div class="help" style="margin:0">${esc(
      key.label || key.keyType,
    )}</div></div>`;
    const remove = document.createElement("button");
    remove.className = "ghost small";
    remove.textContent = "删除";
    remove.addEventListener("click", async () => {
      try {
        await api("/api/verify/ssh/keys/delete", {
          method: "POST",
          body: JSON.stringify({ fingerprint: key.fingerprint }),
        });
        await selectMethod("ssh");
      } catch (err) {
        $("ssh-error").textContent = err.message;
        $("ssh-error").classList.remove("hidden");
      }
    });
    item.appendChild(remove);
    container.appendChild(item);
  }
}

// ------------------------------------------------------------------ 答题 / 按钮

function renderQuizPanel(panel, data) {
  panel.innerHTML = `<h1 class="panel-title">答题验证</h1><p class="help">${esc(data.note || "")}</p>`;
  const form = document.createElement("form");
  (data.questions || []).forEach((question, index) => {
    const block = document.createElement("div");
    block.className = "question";
    block.innerHTML = `<p>${index + 1}. ${esc(question.question)}</p>`;
    question.options.forEach((option, optionIndex) => {
      const label = document.createElement("label");
      label.className = "option";
      label.innerHTML = `<input type="radio" name="q${index}" value="${optionIndex}" /><span>${esc(option)}</span>`;
      block.appendChild(label);
    });
    form.appendChild(block);
  });
  const submit = document.createElement("button");
  submit.className = "primary";
  submit.type = "submit";
  submit.textContent = "提交答案";
  form.appendChild(submit);
  const error = document.createElement("p");
  error.className = "error hidden";
  form.appendChild(error);
  panel.appendChild(form);

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const answers = (data.questions || []).map((_, index) => {
      const checked = form.querySelector(`input[name="q${index}"]:checked`);
      return checked ? Number(checked.value) : -1;
    });
    if (answers.some((answer) => answer < 0)) {
      error.textContent = "还有题没答。";
      error.classList.remove("hidden");
      return;
    }
    submit.disabled = true;
    submit.textContent = "判分中…";
    try {
      const result = await api("/api/verify/submit", {
        method: "POST",
        body: JSON.stringify({ method: "quiz", verificationId: state.verification.id, answers }),
      });
      onApproved(result);
    } catch (err) {
      error.textContent = err.message;
      error.classList.remove("hidden");
      submit.disabled = false;
      submit.textContent = "提交答案";
    }
  });
}

function renderButtonPanel(panel, data) {
  panel.innerHTML = `<h1 class="panel-title">一键确认</h1><p class="help">${esc(data.note || "")}</p>`;
  const button = document.createElement("button");
  button.className = "primary";
  button.textContent = "我是真人，放行";
  button.addEventListener("click", async () => {
    button.disabled = true;
    button.textContent = "处理中…";
    try {
      const result = await api("/api/verify/submit", {
        method: "POST",
        body: JSON.stringify({ method: "button", verificationId: state.verification.id }),
      });
      onApproved(result);
    } catch (err) {
      button.disabled = false;
      button.textContent = "我是真人，放行";
      showPanelError(err.message);
    }
  });
  panel.appendChild(button);
}

// ------------------------------------------------------------------ 状态

function onApproved(result) {
  clearInterval(state.timer);
  $("pending").classList.add("hidden");
  $("success").classList.remove("hidden");
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
    el.textContent = left > 0
      ? `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`
      : "已过期";
    if (left === 0) {
      clearInterval(state.timer);
      $("method-panel").innerHTML = '<p class="help">这次验证已超时，请回群里重新申请。</p>';
    }
  };
  tick();
  state.timer = setInterval(tick, 1000);
}

// ------------------------------------------------------------------ 审计

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
    ? `<span class="badge ok">哈希链完整（${chain.checked} 条）</span>`
    : `<span class="badge bad">哈希链在 #${chain.brokenAtId} 断开</span>`;

  const verificationRows = (data.verifications || [])
    .map(
      (row) => `<tr>
        <td class="mono">${esc(new Date(row.createdAt).toLocaleString())}</td>
        <td>${esc(row.userName || row.userId)}<br /><span class="muted mono">${esc(row.userId)}</span></td>
        <td>${esc(labels[row.status] || row.status)}${row.method ? `<br /><span class="muted">${esc(row.method)}</span>` : ""}</td>
        <td>${esc(row.reason || "")}${row.operatorId ? `<br /><span class="muted">by ${esc(row.operatorId)}</span>` : ""}</td>
      </tr>`,
    )
    .join("");

  const auditRows = (data.audit || [])
    .map(
      (row) => `<tr>
        <td class="mono">${esc(new Date(row.ts).toLocaleString())}</td>
        <td>${esc(row.actorType)}<br /><span class="muted mono">${esc(row.actorId)}</span></td>
        <td>${esc(row.action)}</td>
        <td class="wrap">${esc(row.targetUserId || "")}${
          row.detail ? `<br /><span class="muted">${esc(JSON.stringify(row.detail).slice(0, 120))}</span>` : ""
        }</td>
      </tr>`,
    )
    .join("");

  $("audit-body").innerHTML = `
    <div class="stats">${statCards}</div>
    <div class="card">${chainBadge}</div>
    <div class="card">
      <h2>验证记录</h2>
      <table><thead><tr><th>时间</th><th>用户</th><th>状态</th><th>原因 / 操作者</th></tr></thead>
      <tbody>${verificationRows || '<tr><td colspan="4" class="muted">暂无记录</td></tr>'}</tbody></table>
    </div>
    <div class="card">
      <h2>审计日志</h2>
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
  } catch (err) {
    $("audit-hint").textContent = `导出失败：${err.message}`;
  }
}

// ------------------------------------------------------------------ 初始化

document.querySelectorAll(".tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((other) => other.classList.toggle("active", other === tab));
    const target = tab.dataset.tab;
    $("view-verify").classList.toggle("hidden", target !== "verify");
    $("view-audit").classList.toggle("hidden", target !== "audit");
    if (target === "audit") {
      if (!tg?.initData && !state.token) $("token-card").classList.remove("hidden");
      if (!$("audit-chat").value) {
        const fromUrl = new URLSearchParams(location.search).get("chat");
        $("audit-chat").value = fromUrl || localStorage.getItem("paffbot.chat") || "";
      }
    }
  });
});

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

loadSession();
