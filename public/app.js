/* paffbot Mini App —— 无框架，直接操作 DOM。 */

const tg = window.Telegram?.WebApp;
const state = {
  session: null,
  activeMethod: null,
  verification: null,
  token: localStorage.getItem("paffbot.token") || "",
  countdownTimer: null,
  auditChat: null,
};

const $ = (id) => document.getElementById(id);
const esc = (value) =>
  String(value ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);

if (tg) {
  tg.ready();
  tg.expand();
  try {
    tg.setHeaderColor?.("secondary_bg_color");
    tg.setBackgroundColor?.("bg_color");
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

function setWho(name) {
  $("whoami").textContent = name ? `已识别：${name}` : "群验证 / 审计";
}

// ------------------------------------------------------------------ 验证

async function loadSession() {
  try {
    const data = await api("/api/session");
    state.session = data;
    state.verification = data.verification;
    setWho(data.user?.name);
    $("verify-loading").classList.add("hidden");

    if (!data.verification) {
      $("verify-empty").classList.remove("hidden");
      $("verify-pending").classList.add("hidden");
      return;
    }

    $("verify-empty").classList.add("hidden");
    $("verify-pending").classList.remove("hidden");
    $("chat-title").textContent = data.verification.chatTitle || String(data.verification.chatId);
    $("result-card").classList.add("hidden");
    $("method-panel").classList.remove("hidden");

    renderMethodTabs(data.methods);
    startCountdown(data.verification.expiresAt);
    await selectMethod(state.activeMethod || data.methods[0]?.id);
  } catch (err) {
    $("verify-loading").textContent = `加载失败：${err.message}`;
    if (err.status === 401 && !tg?.initData) {
      $("token-card").classList.remove("hidden");
    }
  }
}

function renderMethodTabs(methods) {
  const box = $("method-tabs");
  box.innerHTML = "";
  if (methods.length <= 1) return;
  for (const method of methods) {
    const btn = document.createElement("button");
    btn.className = "chip";
    btn.textContent = method.label;
    btn.dataset.method = method.id;
    btn.addEventListener("click", () => selectMethod(method.id));
    box.appendChild(btn);
  }
}

async function selectMethod(methodId) {
  if (!methodId) return;
  state.activeMethod = methodId;
  for (const chip of document.querySelectorAll("#method-tabs .chip")) {
    chip.classList.toggle("active", chip.dataset.method === methodId);
  }
  const panel = $("method-panel");
  panel.innerHTML = '<p class="muted">加载验证方式…</p>';
  try {
    const data = await api(
      `/api/verify/start?method=${encodeURIComponent(methodId)}&verificationId=${encodeURIComponent(state.verification.id)}`,
    );
    renderPanel(methodId, data);
  } catch (err) {
    panel.innerHTML = `<p class="alert">${esc(err.message)}</p>`;
  }
}

function renderPanel(methodId, data) {
  const panel = $("method-panel");
  if (methodId === "ssh") renderSshPanel(panel, data);
  else if (methodId === "quiz") renderQuizPanel(panel, data);
  else renderButtonPanel(panel, data);
}

function renderSshPanel(panel, data) {
  panel.innerHTML = "";
  panel.insertAdjacentHTML(
    "beforeend",
    `<h2>SSH 公钥签名</h2>
     <p class="hint">用你本机的 SSH 私钥对下面这段一次性挑战串签名。签名只对这次验证有效，重放没用。</p>
     <pre id="ssh-challenge"></pre>
     <div class="row gap">
       <button class="btn ghost small" id="ssh-copy">复制挑战串</button>
       <button class="btn ghost small" id="ssh-toggle-key">登记新公钥</button>
     </div>
     <div id="ssh-key-form" class="hidden" style="margin-top:10px">
       <label class="field">
         <span>公钥内容（cat ~/.ssh/id_ed25519.pub）</span>
         <textarea id="ssh-pubkey" placeholder="ssh-ed25519 AAAAC3NzaC1lZDI1NTE5... you@host"></textarea>
       </label>
       <label class="field">
         <span>备注（可选）</span>
         <input id="ssh-label" placeholder="我的笔记本" />
       </label>
       <button class="btn" id="ssh-save-key">保存公钥</button>
     </div>
     <div id="ssh-keys" style="margin-top:10px"></div>
     <h2 style="margin-top:16px">签名命令</h2>
     <pre id="ssh-cmd">printf '%s' '&lt;challenge&gt;' &gt; msg.txt
ssh-keygen -Y sign -n paffbot -f ~/.ssh/id_ed25519 msg.txt
cat msg.txt.sig</pre>
     <label class="field">
       <span>把 msg.txt.sig 的内容粘到这里</span>
       <textarea id="ssh-signature" placeholder="-----BEGIN SSH SIGNATURE-----"></textarea>
     </label>
     <button class="btn" id="ssh-submit">提交签名</button>
     <p class="alert hidden" id="ssh-error"></p>`,
  );

  const challenge = data.challenge || "";
  $("ssh-challenge").textContent = challenge;
  $("ssh-cmd").textContent =
    `printf '%s' '${challenge}' > msg.txt\n` +
    `ssh-keygen -Y sign -n paffbot -f ~/.ssh/id_ed25519 msg.txt\n` +
    `cat msg.txt.sig`;

  $("ssh-copy").addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(challenge);
      $("ssh-copy").textContent = "已复制";
      setTimeout(() => ($("ssh-copy").textContent = "复制挑战串"), 1500);
    } catch {
      $("ssh-error").textContent = "复制失败，请手动选中上面的挑战串。";
      $("ssh-error").classList.remove("hidden");
    }
  });

  $("ssh-toggle-key").addEventListener("click", () => $("ssh-key-form").classList.toggle("hidden"));

  $("ssh-save-key").addEventListener("click", async () => {
    const publicKey = $("ssh-pubkey").value.trim();
    const label = $("ssh-label").value.trim();
    if (!publicKey) return;
    try {
      const saved = await api("/api/verify/ssh/keys", {
        method: "POST",
        body: JSON.stringify({ publicKey, label }),
      });
      $("ssh-pubkey").value = "";
      $("ssh-key-form").classList.add("hidden");
      await selectMethod("ssh");
      showError(`已登记 ${saved.fingerprint}`, false);
    } catch (err) {
      showError(err.message);
    }
  });

  renderKeys($("ssh-keys"), data.keys || []);

  $("ssh-submit").addEventListener("click", async () => {
    const signature = $("ssh-signature").value.trim();
    if (!signature) return showError("先粘贴签名内容");
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
      showError(err.message);
    } finally {
      button.disabled = false;
      button.textContent = "提交签名";
    }
  });
}

function renderKeys(container, keys) {
  container.innerHTML = "";
  if (keys.length === 0) {
    container.innerHTML = '<p class="hint">还没有登记公钥。</p>';
    return;
  }
  container.insertAdjacentHTML("beforeend", '<p class="hint">已登记的公钥</p>');
  for (const key of keys) {
    const item = document.createElement("div");
    item.className = "key-item";
    item.innerHTML = `<div><div class="mono">${esc(key.fingerprint)}</div><div class="hint">${esc(
      key.label || key.keyType,
    )}</div></div>`;
    const del = document.createElement("button");
    del.className = "btn ghost small";
    del.textContent = "删除";
    del.addEventListener("click", async () => {
      try {
        await api("/api/verify/ssh/keys/delete", {
          method: "POST",
          body: JSON.stringify({ fingerprint: key.fingerprint }),
        });
        await selectMethod("ssh");
      } catch (err) {
        showError(err.message);
      }
    });
    item.appendChild(del);
    container.appendChild(item);
  }
}

function renderQuizPanel(panel, data) {
  panel.innerHTML = "";
  const form = document.createElement("form");
  form.innerHTML = `<h2>答题</h2><p class="hint">${esc(data.note || "")}</p>`;
  (data.questions || []).forEach((question, index) => {
    const block = document.createElement("div");
    block.className = "question";
    block.innerHTML = `<p>${index + 1}. ${esc(question.question)}</p>`;
    question.options.forEach((option, optionIndex) => {
      const label = document.createElement("label");
      label.className = "option";
      label.innerHTML = `<input type="radio" name="q${index}" value="${optionIndex}" /> <span>${esc(option)}</span>`;
      block.appendChild(label);
    });
    form.appendChild(block);
  });
  const submit = document.createElement("button");
  submit.className = "btn";
  submit.type = "submit";
  submit.textContent = "提交答案";
  form.appendChild(submit);
  const error = document.createElement("p");
  error.className = "alert hidden";
  form.appendChild(error);
  panel.appendChild(form);

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const answers = (data.questions || []).map((_, index) => {
      const checked = form.querySelector(`input[name="q${index}"]:checked`);
      return checked ? Number(checked.value) : -1;
    });
    if (answers.some((a) => a < 0)) {
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
  panel.innerHTML = `<h2>一键确认</h2><p class="hint">${esc(data.note || "点击下方按钮完成验证")}</p>`;
  const button = document.createElement("button");
  button.className = "btn";
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
      showError(err.message);
    }
  });
  panel.appendChild(button);
}

function showError(message, asError = true) {
  const panel = $("method-panel");
  let box = panel.querySelector(".alert");
  if (!box) {
    box = document.createElement("p");
    box.className = "alert";
    panel.appendChild(box);
  }
  box.textContent = message;
  box.classList.toggle("alert", asError);
  box.classList.toggle("success", !asError);
  box.classList.remove("hidden");
}

function onApproved(result) {
  clearInterval(state.countdownTimer);
  $("method-panel").classList.add("hidden");
  $("method-tabs").classList.add("hidden");
  const card = $("result-card");
  card.classList.remove("hidden");
  $("result-title").textContent = "✅ 验证通过";
  $("result-text").textContent = `已放行你加入「${result.chatTitle || "群组"}」，可以回到群聊了。`;
  try {
    tg?.HapticFeedback?.notificationOccurred("success");
  } catch {}
}

function startCountdown(expiresAt) {
  clearInterval(state.countdownTimer);
  const el = $("countdown");
  const tick = () => {
    const left = Math.max(0, expiresAt - Date.now());
    const total = Math.floor(left / 1000);
    const m = String(Math.floor(total / 60)).padStart(2, "0");
    const s = String(total % 60).padStart(2, "0");
    el.textContent = left > 0 ? `${m}:${s}` : "已过期";
    el.classList.toggle("muted", left === 0);
    if (left === 0) {
      clearInterval(state.countdownTimer);
      $("method-panel").innerHTML = '<p class="hint">这次验证已超时，请回群里重新申请。</p>';
    }
  };
  tick();
  state.countdownTimer = setInterval(tick, 1000);
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
    $("audit-hint").textContent = `群 ${chatId}：共 ${data.verificationsTotal} 条验证、${data.auditTotal} 条审计。`;
    renderAudit(data);
    $("token-card").classList.add("hidden");
  } catch (err) {
    $("audit-hint").textContent = `查询失败：${err.message}`;
    if (err.status === 401) $("token-card").classList.remove("hidden");
  }
}

function renderAudit(data) {
  const body = $("audit-body");
  const stats = data.stats || {};
  const labels = { pending: "待验证", approved: "已放行", declined: "已拒绝", timeout: "超时", banned: "已封禁", blocked: "自动拦截" };

  const statCards = Object.entries(labels)
    .map(([key, label]) => `<div class="stat"><b>${Number(stats[key] || 0)}</b><span>${label}</span></div>`)
    .join("");

  const chain = data.chain || { ok: true, checked: 0 };
  const chainBadge = chain.ok
    ? `<span class="badge ok">哈希链完整（${chain.checked}）</span>`
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
        <td class="wrap">${esc(row.targetUserId || "")}${row.detail ? `<br /><span class="muted">${esc(JSON.stringify(row.detail).slice(0, 120))}</span>` : ""}</td>
      </tr>`,
    )
    .join("");

  body.innerHTML = `
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
    document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("active", t === tab));
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

$("btn-refresh").addEventListener("click", loadSession);
$("btn-close").addEventListener("click", () => tg?.close?.());
$("btn-audit-load").addEventListener("click", loadAudit);
$("btn-audit-csv").addEventListener("click", downloadCsv);
$("btn-token").addEventListener("click", () => {
  state.token = $("admin-token").value.trim();
  localStorage.setItem("paffbot.token", state.token);
  $("token-card").classList.add("hidden");
  loadSession();
});

loadSession();
