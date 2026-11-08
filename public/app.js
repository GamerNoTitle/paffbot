import { applyTheme, telegramSeed, DEFAULT_SEED } from "./vendor/material.js";
import { shapeMask, shapeSvg } from "./shapes.js";
import { applyStaticI18n, detectLang, LANGUAGES, setLang, t } from "./i18n/index.js";

/* ---------------------------------------------------------------- 基础环境 */

const tg = window.Telegram?.WebApp;
const params = new URLSearchParams(location.search);
const PREVIEW = params.get("preview") === "1";
const TG_LANG = window.Telegram?.WebApp?.initDataUnsafe?.user?.language_code;
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
    '<path d="M19 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2Zm0 12h-4a3 3 0 0 1-6 0H5V5h14v10Z"/>',
  copy: '<path d="M16 1H4a2 2 0 0 0-2 2v14h2V3h12V1Zm3 4H8a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2Zm0 16H8V7h11v14Z"/>',
  error: '<path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm1 15h-2v-2h2v2Zm0-4h-2V7h2v6Z"/>',
  clock: '<path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm0 18a8 8 0 1 1 0-16 8 8 0 0 1 0 16Zm1-13h-2v6l5 3 1-1.7-4-2.3V7Z"/>',
  stack: '<path d="M12 3 2 8l10 5 10-5-10-5Zm0 7.8L4.5 7 12 3.2 19.5 7 12 10.8ZM2 16l10 5 10-5-1.8-.9L12 18.8 3.8 15.1 2 16Zm0-4 10 5 10-5-1.8-.9L12 14.8 3.8 11.1 2 12Z"/>',
  chevron: '<path d="M12 15.4 5.6 9 7 7.6l5 5 5-5L18.4 9 12 15.4Z"/>',
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
  session: null,
  github: null,
  panelData: null,
  standaloneData: null,
  standaloneRemaining: null,
  countdownText: "",
  superAdmin: false,
  auditLoaded: false,
  oauthEnabled: false,
  captchaEnabled: false,
  captchaTimer: null,
  githubLogin: "",
  oauthTimer: 0,
};

function paintTheme() {
  applyTheme({ seed, dark });
  $("theme-icon").innerHTML = svgIcon(dark ? "light" : "dark", 22);
  $("theme-toggle").setAttribute("aria-label", t("nav.theme"));
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

  // 传对象也当成 JSON，省得每个调用点都写 JSON.stringify
  const init = { ...options, headers };
  if (init.body && typeof init.body === "object") init.body = JSON.stringify(init.body);
  const res = await fetch(path, init);
  let data = {};
  try {
    data = await res.json();
  } catch {
    data = { ok: false, error: t("err.nonJson", { status: res.status }) };
  }
  if (!res.ok || data.ok === false) {
    const error = new Error(data.error || `HTTP ${res.status}`);
    error.status = res.status;
    error.errorKey = data.errorKey;
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
    state.session = data;
    state.github = data.github || null;
    state.botUsername = data.botUsername || "";
    state.superAdmin = Boolean(data.superAdmin);
    state.oauthEnabled = Boolean(data.oauth?.enabled);
    state.captchaEnabled = (data.methods ?? []).some((m) => m.id === "captcha");
    state.githubLogin = data.github?.login || "";

    if (!data.verification) {
      const name = data.user?.name?.split(" ")[0];
      setHero({
        eyebrow: t("hero.eyebrow"),
        title: name ? t("hero.greeting", { name }) : t("hero.noPending"),
        sub: t("hero.noPendingGroup"),
        chips: [],
      });
      renderBoundAccount(data.github);
      applyNavVisibility();
      showState("empty");
      return;
    }

    const v = data.verification;
    setHero({
      eyebrow: t("hero.eyebrow"),
      title: t("hero.verifyTitle"),
      sub: v.chatTitle ?? String(v.chatId),
      group: { title: v.chatTitle ?? String(v.chatId), photo: v.chatPhoto || "" },
      chips: [{ text: t("hero.remaining", { time: "05:00" }), id: "hero-countdown", strong: true }],
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
      $("empty-title").textContent = t("state.loadFail");
      $("empty-text").textContent = err.message;
      setHero({ eyebrow: t("app.name"), title: t("audit.loadFail", { error: "" }).trim(), sub: err.message, chips: [] });
    }
  }
}

async function loadPanel() {
  const panel = $("method-panel");
  panel.innerHTML = `<p class="md-typescale-body-medium muted">${esc(t("panel.loading"))}</p>`;
  if (PREVIEW) {
    const fake = { challenge: state.challenge, requirements: { minAccountAgeDays: 0, requiredOrg: null } };
    state.panelData = fake;
    if (state.oauthEnabled) {
      renderMethodPanel(panel, fake);
      return;
    }
    renderGithubPanel(panel, fake);
    const button = $("gh-submit");
    button.disabled = true;
    button.textContent = t("panel.previewSubmit");
    return;
  }
  try {
    const data = await api(
      `/api/verify/start?method=github&verificationId=${encodeURIComponent(state.verification.id)}`,
    );
    state.challenge = data.challenge || "";
    state.panelData = data;
    renderMethodPanel(panel, data);
  } catch (err) {
    panel.innerHTML = `<p class="md-typescale-body-medium" style="color:var(--md-sys-color-error)">${esc(err.message)}</p>`;
  }
}

/** 没有待验证申请时，只显示已经绑定过的 GitHub 账号。 */
function renderBoundAccount(github) {
  const box = $("bound");
  if (!box) return;
  if (!github?.login) {
    box.classList.add("hidden");
    box.innerHTML = "";
    return;
  }
  const login = github.login;
  box.innerHTML = `
    <img class="bound__avatar" src="/api/github/avatar/${encodeURIComponent(login)}" alt="" loading="lazy" onerror="this.remove()" />
    <span><a href="https://github.com/${encodeURIComponent(login)}" target="_blank" rel="noreferrer">${esc(
      t("empty.bound", { login }),
    )}</a></span>`;
  box.classList.remove("hidden");
}

/** 面板顶部的方式切换：签名（纯前端算） / OAuth（要跳 GitHub）。 */

/** 三个验证方式的图标，统一 currentColor，尺寸交给 CSS。 */
const METHOD_ICONS = {
  ssh: '<svg viewBox="0 0 1024 1024" aria-hidden="true"><path fill="currentColor" d="M418.133333 499.2c-21.333333-34.133333-29.866667-72.533333-29.866666-115.2 0-119.466667 93.866667-213.333333 213.333333-213.333333s213.333333 93.866667 213.333333 213.333333-93.866667 213.333333-213.333333 213.333333c-46.933333 0-85.333333-12.8-123.733333-38.4l-98.133334 98.133334 46.933334 46.933333-59.733334 59.733333-46.933333-46.933333-29.866667 29.866667 46.933334 46.933333L277.333333 853.333333 170.666667 746.666667l247.466666-247.466667zM601.6 256c-72.533333 0-128 55.466667-128 128s55.466667 128 128 128 128-55.466667 128-128-59.733333-128-128-128z"/></svg>',
  oauth: '<svg viewBox="0 0 98 96" aria-hidden="true"><path fill="currentColor" d="M41.4395 69.3848C28.8066 67.8535 19.9062 58.7617 19.9062 46.9902C19.9062 42.2051 21.6289 37.0371 24.5 33.5918C23.2559 30.4336 23.4473 23.7344 24.8828 20.959C28.7109 20.4805 33.8789 22.4902 36.9414 25.2656C40.5781 24.1172 44.4062 23.543 49.0957 23.543C53.7852 23.543 57.6133 24.1172 61.0586 25.1699C64.0254 22.4902 69.2891 20.4805 73.1172 20.959C74.457 23.543 74.6484 30.2422 73.4043 33.4961C76.4668 37.1328 78.0937 42.0137 78.0937 46.9902C78.0937 58.7617 69.1934 67.6621 56.3691 69.2891C59.623 71.3945 61.8242 75.9883 61.8242 81.252L61.8242 91.2051C61.8242 94.0762 64.2168 95.7031 67.0879 94.5547C84.4102 87.9512 98 70.6289 98 49.1914C98 22.1074 75.9883 6.69539e-07 48.9043 4.309e-07C21.8203 1.92261e-07 -1.9479e-07 22.1074 -4.3343e-07 49.1914C-6.20631e-07 70.4375 13.4941 88.0469 31.6777 94.6504C34.2617 95.6074 36.75 93.8848 36.75 91.3008L36.75 83.6445C35.4102 84.2188 33.6875 84.6016 32.1562 84.6016C25.8398 84.6016 22.1074 81.1563 19.4277 74.7441C18.375 72.1602 17.2266 70.6289 15.0254 70.3418C13.877 70.2461 13.4941 69.7676 13.4941 69.1934C13.4941 68.0449 15.4082 67.1836 17.3223 67.1836C20.0977 67.1836 22.4902 68.9063 24.9785 72.4473C26.8926 75.2227 28.9023 76.4668 31.2949 76.4668C33.6875 76.4668 35.2187 75.6055 37.4199 73.4043C39.0469 71.7773 40.291 70.3418 41.4395 69.3848Z"/></svg>',
  captcha: '<svg viewBox="0 0 1024 1024" aria-hidden="true"><path fill="currentColor" d="M941.639344 146.360656l-25.180328-0.52459c-1.04918 0-101.245902-2.098361-205.639344-43.016394-105.967213-40.918033-175.213115-89.180328-175.737705-89.704918L519.868852 2.622951c-2.098361-1.57377-5.245902-2.622951-8.393442-2.622951-3.147541 0-5.770492 1.04918-7.868853 2.622951l-15.213114 10.491803c-2.622951 2.098361-70.295082 48.786885-175.737705 90.229508-104.393443 40.918033-204.590164 43.016393-205.639345 43.016394l-25.180327 0.52459C74.491803 146.360656 68.721311 152.131148 68.721311 158.95082v419.147541c0 97.04918 59.803279 207.737705 163.672132 303.737705 93.377049 86.032787 203.016393 142.163934 279.081967 142.163934 76.590164 0 186.229508-55.606557 279.606557-142.163934 103.868852-96 163.672131-206.688525 163.672131-304.262296V158.95082c0-6.819672-5.770492-12.590164-13.114754-12.590164z m-209.311475 256l-268.590164 268.065574c-6.295082 6.295082-15.213115 9.967213-24.131148 9.967213s-17.836066-3.672131-24.131147-9.967213l-123.803279-123.803279c-13.114754-13.114754-13.114754-35.147541 0-48.262295 6.295082-6.295082 15.213115-9.967213 24.131148-9.967213 8.918033 0 17.836066 3.672131 24.131147 9.967213l99.672131 99.672131 243.934427-243.934426c6.295082-6.295082 15.213115-9.967213 24.131147-9.967213 9.442623 0 17.836066 3.672131 24.655738 9.967213 6.295082 6.295082 9.967213 15.213115 9.967213 24.131147 0 8.918033-3.147541 17.311475-9.967213 24.131148z"/></svg>',
};

function methodIcon(id) {
  return METHOD_ICONS[id] ?? "";
}

function renderMethodPanel(panel, data) {
  // 人机验证已通过：不再给任何提交入口，只等管理员放行
  if (state.verification?.captchaPassed) {
    panel.innerHTML = `
      <div class="state">
        <div class="state__icon" id="empty-icon"></div>
        <h2 class="md-typescale-headline-small">${esc(t("panel.captcha.waiting"))}</h2>
      </div>`;
    const icon = $("empty-icon");
    if (icon) icon.innerHTML = svgIcon("check", 30);
    return;
  }

  const tabs = [{ id: "ssh", label: t("method.ssh") }];
  if (state.oauthEnabled) tabs.push({ id: "oauth", label: t("method.oauth") });
  if (state.captchaEnabled) tabs.push({ id: "captcha", label: t("method.captcha") });

  if (state.standalone || tabs.length === 1) {
    renderGithubPanel(panel, data);
    return;
  }

  panel.innerHTML = `
    <div class="segmented segmented--sm panel__switch" role="tablist" aria-label="${esc(t("panel.methods"))}" id="pm-switch">
      ${tabs
        .map(
          (tab, i) =>
            `<button type="button" role="tab" data-method="${tab.id}" aria-selected="${i === 0}">${methodIcon(tab.id)}<span>${esc(tab.label)}</span></button>`,
        )
        .join("")}
    </div>
    <div id="pm-body"></div>`;

  const body = $("pm-body");
  const switchTo = (method) => {
    for (const b of $("pm-switch").querySelectorAll("button")) {
      b.setAttribute("aria-selected", String(b.dataset.method === method));
    }
    stopOAuthPolling();
    stopCaptchaPolling();
    if (method === "oauth") renderOAuthPanel(body);
    else if (method === "captcha") renderCaptchaPanel(body);
    else renderGithubPanel(body, data);
  };

  for (const b of $("pm-switch").querySelectorAll("button")) {
    b.addEventListener("click", () => switchTo(b.dataset.method));
  }
  switchTo("ssh");
}

function stopCaptchaPolling() {
  if (state.captchaTimer) {
    clearInterval(state.captchaTimer);
    state.captchaTimer = null;
  }
}

/** 人机验证：Cap 的 web component 自己解题，打完这两枪我们这边只等管理员放行。 */
async function renderCaptchaPanel(body) {
  if (state.verification?.captchaPassed) {
    body.innerHTML = `<div class="state">
      <div class="state__icon" id="empty-icon"></div>
      <h2 class="md-typescale-headline-small">${esc(t("panel.captcha.waiting"))}</h2>
    </div>`;
    const icon = $("empty-icon");
    if (icon) icon.innerHTML = svgIcon("check", 30);
    return;
  }

  body.innerHTML = `<p class="md-typescale-body-medium muted">${esc(t("panel.captcha.loading"))}</p>`;

  const start = await api(`/api/verify/start?method=captcha&verificationId=${state.verification?.id ?? ""}`);
  if (!start.ok) {
    body.innerHTML = `<p class="md-typescale-body-medium" style="color:var(--md-sys-color-error)">${esc(start.error ?? "")}</p>`;
    return;
  }

  const req = start.requirements ?? {};

  // Turnstile：官方脚本渲染，成功后由用户点按钮再提交
  if (req.provider === "turnstile") {
    if (!req.siteKey) {
      body.innerHTML = `<p class="md-typescale-body-medium" style="color:var(--md-sys-color-error)">${esc(t("panel.captcha.failed"))}</p>`;
      return;
    }
    await loadScriptOnce("https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit");

    body.innerHTML = `
      <div class="panel__head panel__head--center">
        <h2 class="md-typescale-headline-medium">${esc(t("panel.captcha.title"))}</h2>
        <p class="md-typescale-body-medium muted">${esc(t("panel.captcha.desc"))}</p>
      </div>
      <div id="ts-slot" class="captcha"></div>
      <div class="captcha__actions">
        <md-filled-button id="cap-go" disabled>${esc(t("panel.captcha.submit"))}</md-filled-button>
      </div>
      <p id="cap-err" class="md-typescale-body-small captcha__err"></p>`;

    let turnstileToken = "";
    let submitting = false;
    let widgetId = null;
    const go = $("cap-go");
    const enable = () => {
      go.removeAttribute("disabled");
      go.disabled = false;
    };
    const disable = () => {
      go.setAttribute("disabled", "");
      go.disabled = true;
    };

    go.addEventListener("click", async () => {
      // 某些情况下 callback 没跑，但组件其实已经出 token，这里兜一下
      if (!turnstileToken) turnstileToken = window.turnstile?.getResponse?.("#ts-slot") || "";
      if (!turnstileToken || submitting) return;

      submitting = true;
      disable();
      try {
        await api("/api/verify/submit", {
          method: "POST",
          body: { method: "captcha", turnstileToken, verificationId: state.verification?.id },
        });
      } catch (err) {
        submitting = false;
        turnstileToken = "";
        window.turnstile?.reset("#ts-slot");
        disable();
        const hint = document.getElementById("cap-err");
        if (hint) hint.textContent = err?.message ?? t("panel.captcha.failed");
        return;
      }
      stopCaptchaPolling();
      const fresh = await api("/api/session").catch(() => null);
      if (fresh?.verification) state.verification = fresh.verification;
      renderCaptchaPanel(body);
    });

    widgetId = window.turnstile?.render("#ts-slot", {
      sitekey: String(req.siteKey),
      appearance: "always",
      theme: document.documentElement.dataset.theme === "dark" ? "dark" : "light",
      callback: (token) => {
        turnstileToken = token;
        enable();
        // 自定义元素可能还没升级完，升级后再解一次
        globalThis.customElements?.whenDefined?.("md-filled-button").then(enable).catch(() => undefined);
      },
      "expired-callback": () => {
        turnstileToken = "";
        disable();
      },
    });

    // 组件自己过掉时 callback 可能已经绑到旧的 DOM 上，这里再盯一眼输入框
    stopCaptchaPolling();
    state.captchaTimer = setInterval(() => {
      if (turnstileToken) return;
      const token = window.turnstile?.getResponse?.(widgetId ?? "#ts-slot");
      if (typeof token === "string" && token) {
        turnstileToken = token;
        enable();
      }
    }, 800);
    return;
  }

  try {
    if (req.widget) await loadScriptOnce(req.widget);
  } catch (err) {
    body.innerHTML = `<p class="md-typescale-body-medium captcha__err">${esc(err?.message ?? t("panel.captcha.failed"))}</p>`;
    return;
  }

  body.innerHTML = `
    <div class="panel__head panel__head--center">
      <h2 class="md-typescale-headline-medium">${esc(t("panel.captcha.title"))}</h2>
      <p class="md-typescale-body-medium muted">${esc(t("panel.captcha.desc"))}</p>
    </div>
    <div class="captcha" data-endpoint="${esc(req.endpoint ?? "")}"></div>
    <div class="captcha__actions">
      <md-filled-button id="cap-go" disabled>${esc(t("panel.captcha.submit"))}</md-filled-button>
    </div>
    <p id="cap-err" class="md-typescale-body-small captcha__err"></p>`;

  const mount = body.querySelector(".captcha");
  const widget = document.createElement("cap-widget");
  widget.setAttribute("data-cap-api-endpoint", String(req.endpoint ?? ""));
  // Cap 组件自带英文文案，用它的 i18n 属性改成中文
  const capCopy = {
    "data-cap-i18n-initial-state": "点击开始验证",
    "data-cap-i18n-verifying-label": "正在计算…",
    "data-cap-i18n-solved-label": "计算完成",
    "data-cap-i18n-error-label": "验证失败，重试一次",
    "data-cap-i18n-verify-aria-label": "点击开始验证",
    "data-cap-i18n-verifying-aria-label": "正在计算，请稍候",
    "data-cap-i18n-verified-aria-label": "计算完成，请点下方按钮",
    "data-cap-i18n-error-aria-label": "验证出错，请重试",
  };
  for (const [k, v] of Object.entries(capCopy)) widget.setAttribute(k, v);
  mount.appendChild(widget);

  const go = $("cap-go");
  let submitting = false;
  const enable = () => {
    go.removeAttribute("disabled");
    go.disabled = false;
  };
  const disable = () => {
    go.setAttribute("disabled", "");
    go.disabled = true;
  };

  // 组件算完只会解锁按钮，真正的提交和推送要点一下
  widget.addEventListener("solve", enable);

  go.addEventListener("click", async () => {
    if (submitting || go.hasAttribute("disabled")) return;
    submitting = true;
    disable();
    try {
      await api("/api/verify/submit", {
        method: "POST",
        body: { method: "captcha", verificationId: state.verification?.id },
      });
    } catch (err) {
      submitting = false;
      disable();
      const hint = $("cap-err");
      if (hint) hint.textContent = err?.message ?? t("panel.captcha.failed");
      return;
    }
    stopCaptchaPolling();
    const fresh = await api("/api/session").catch(() => null);
    if (fresh?.verification) state.verification = fresh.verification;
    renderCaptchaPanel(body);
  });

  // 兜底：没收到 solve 事件时，靠会话状态解锁
  stopCaptchaPolling();
  state.captchaTimer = setInterval(async () => {
    const fresh = await api("/api/session").catch(() => null);
    const current = fresh?.verification;
    if (!current) return;
    if (current.captchaPassed) {
      stopCaptchaPolling();
      state.verification = current;
      renderCaptchaPanel(body);
      return;
    }
    if (current.captchaSolved) enable();
  }, 2000);
}

function loadScriptOnce(src) {
  if ([...document.scripts].some((s) => s.src === src)) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const el = document.createElement("script");
    el.src = src;
    el.async = true;
    const timer = setTimeout(() => reject(new Error(`脚本加载超时：${src}`)), 12_000);
    el.onload = () => {
      clearTimeout(timer);
      resolve();
    };
    el.onerror = () => {
      clearTimeout(timer);
      reject(new Error(`脚本加载失败：${src}`));
    };
    document.head.appendChild(el);
  });
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
      <h2 class="md-typescale-headline-medium">${esc(t("panel.oauth.title"))}</h2>
      <p class="md-typescale-body-medium muted">
        ${esc(t("panel.oauth.desc"))}
        ${
          state.githubLogin
            ? `<span class="bound bound--inline"><img class="bound__avatar" src="/api/github/avatar/${encodeURIComponent(
                state.githubLogin,
              )}" alt="" loading="lazy" onerror="this.remove()" />${esc(
                t("panel.oauth.bound", { login: state.githubLogin }),
              )}</span>`
            : ""
        }
      </p>
    </div>
    <div class="actions">
      <md-filled-button id="oauth-start">${esc(t("panel.oauth.start"))}</md-filled-button>
    </div>
    <p class="md-typescale-body-small muted" id="oauth-status" style="margin-top:16px"></p>`;

  $("oauth-start").addEventListener("click", async () => {
    const button = $("oauth-start");
    button.disabled = true;
    $("oauth-status").textContent = t("panel.oauth.opening");

    try {
      const data = await api(
        `/api/oauth/github/start?verificationId=${encodeURIComponent(state.verification.id)}`,
      );
      const url = data.url;
      if (tg?.openLink) tg.openLink(url);
      else window.open(url, "_blank", "noopener");

      $("oauth-status").textContent = t("panel.oauth.opened");
      stopOAuthPolling();
      state.oauthTimer = window.setInterval(async () => {
        try {
          const status = await api("/api/oauth/github/status");
          if (status.bound) {
            stopOAuthPolling();
            state.githubLogin = status.bound.login;
            $("oauth-status").textContent = t("panel.oauth.done", { login: status.bound.login });
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
  if (requirements.minAccountAgeDays > 0) {
    notes.push(t("panel.ssh.noteAge", { days: requirements.minAccountAgeDays }));
  }
  if (requirements.requiredOrg) {
    notes.push(t("panel.ssh.noteOrg", { org: requirements.requiredOrg }));
  }

  panel.innerHTML = `
    <div class="panel__head">
      <h2 class="md-typescale-headline-medium">${esc(standalone ? t("panel.check.title") : t("panel.ssh.title"))}</h2>
      <p class="md-typescale-body-medium muted">
        ${esc(t("panel.ssh.desc"))}
        <a href="${GITHUB_SSH_DOC}" target="_blank" rel="noreferrer">${esc(t("panel.ssh.doc"))}</a>
      </p>
      ${notes.length ? `<p class="md-typescale-body-small muted">${esc(t("panel.ssh.extra", { notes: notes.join("；") }))}</p>` : ""}
    </div>

    <ol class="steps">
      <li class="step">
        <div class="step__avatar tone-primary">1</div>
        <div class="step__body">
          <h3 class="md-typescale-title-medium">${esc(t("panel.ssh.step1.title"))}</h3>
          <p class="md-typescale-body-medium muted">${esc(t("panel.ssh.step1.sub"))}</p>
          <md-outlined-text-field id="gh-username" label="${esc(t("panel.ssh.step1.label"))}"></md-outlined-text-field>
        </div>
      </li>

      <li class="step">
        <div class="step__avatar tone-secondary">2</div>
        <div class="step__body">
          <h3 class="md-typescale-title-medium">${esc(t("panel.ssh.step2.title"))}</h3>
          <p class="md-typescale-body-medium muted">${esc(t("panel.ssh.step2.sub"))}</p>
          <div class="code">
            <div class="code__head">
              <div class="segmented segmented--sm" role="tablist" aria-label="${esc(t("panel.shell"))}" id="gh-shells"></div>
            </div>
            <pre id="gh-cmd"></pre>
            <div class="code__foot">
              <md-text-button id="gh-copy">${svgIcon("copy", 18)}<span>${esc(t("panel.ssh.copy"))}</span></md-text-button>
            </div>
          </div>
        </div>
      </li>

      <li class="step">
        <div class="step__avatar tone-tertiary">3</div>
        <div class="step__body">
          <h3 class="md-typescale-title-medium">${esc(t("panel.ssh.step3.title"))}</h3>
          <md-outlined-text-field id="gh-signature" type="textarea" rows="5" label="${esc(t("panel.ssh.step3.label"))}"></md-outlined-text-field>
        </div>
      </li>
    </ol>

    <div class="panel__actions">
      <md-filled-button id="gh-submit" disabled>${esc(standalone ? t("panel.check.submit") : t("panel.ssh.submit"))}</md-filled-button>
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
      toast(t("panel.ssh.copied"));
    } catch {
      toast(t("panel.ssh.copyFail"));
    }
  });

  const username = $("gh-username");
  const signature = $("gh-signature");
  const submit = $("gh-submit");

  const refresh = () => {
    const name = username.value.trim().replace(/^@/, "");
    // 用户经常带 @，校验前先去掉
    const nameOk = /^[a-z\d](?:[a-z\d-]{0,37}[a-z\d])?$/i.test(name.replace(/^@+/, ""));
    const sigOk = signature.value.includes("BEGIN SSH SIGNATURE");
    username.error = name.length > 0 && !nameOk;
    signature.error = signature.value.trim().length > 0 && !sigOk;
    submit.disabled = !(nameOk && sigOk);
  };
  username.addEventListener("input", refresh);
  signature.addEventListener("input", refresh);

  submit.addEventListener("click", async () => {
    submit.disabled = true;
    submit.textContent = standalone ? t("panel.checkSubmitting") : t("panel.submitting");
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
        submit.textContent = t("panel.check.submit");
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
      showResultDialog({ title: t("dialog.error.title"), text: err.message, tone: "error" });
      submit.disabled = false;
      submit.textContent = standalone ? t("panel.check.submit") : t("panel.ssh.submit");
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
    eyebrow: t("app.name"),
    title: t("hero.verifyTitle"),
    sub: t("panel.ssh.desc"),
    chips: [],
  });
  await loadStandalonePanel();
}

async function loadStandalonePanel() {
  const panel = $("method-panel");
  panel.innerHTML = `<p class="md-typescale-body-medium muted">${esc(t("panel.preparing"))}</p>`;
  try {
    const data = await api("/api/github/challenge");
    state.checkToken = data.token;
    state.challenge = data.challenge;
    setHero({
      eyebrow: t("app.name"),
      title: t("hero.verifyTitle"),
      sub: t("panel.ssh.desc"),
      chips: [
        ...(typeof data.remaining === "number" ? [{ text: t("hero.attemptsLeft", { count: data.remaining }) }] : []),
        { text: t("hero.remaining", { time: "05:00" }), id: "hero-countdown", strong: true },
      ],
    });
    startCountdown(data.expiresAt);
    state.standaloneData = data;
    state.standaloneRemaining = typeof data.remaining === "number" ? data.remaining : null;
    renderGithubPanel(panel, { challenge: data.challenge, requirements: {} }, "standalone");
  } catch (err) {
    // 没有可用挑战：hero 里的进度条和按钮都不该再显示
    clearInterval(state.timer);
    $("hero-progress").classList.add("hidden");
    setHero({ chips: [] });

    panel.innerHTML = `
      <div class="state">
        <div class="state__icon">${svgIcon("clock", 30)}</div>
        <h2 class="md-typescale-headline-small">${esc(t("state.rateLimited.title"))}</h2>
        <p class="md-typescale-body-medium muted">${esc(err.message)}</p>
      </div>`;
  }
}

function onStandaloneResult(result) {
  $("dialog-title").textContent = t("panel.standaloneDone");
  $("dialog-icon").innerHTML = svgIcon("check", 30);
  $("dialog-text").innerHTML =
    esc(t("dialog.checkOk", { login: result.githubUsername })) +
    `<br><span class="mono md-typescale-body-small">${esc(result.fingerprint ?? "")}</span>`;
  $("success-dialog").show();
}

/* ---------------------------------------------------------------- 状态 */

/** 同一个对话框承担成功/失败两种收尾语气。 */
function showResultDialog({ title, text, tone = "success" }) {
  $("dialog-title").textContent = title;
  $("dialog-icon").innerHTML = svgIcon(tone === "error" ? "error" : "check", 30);
  $("dialog-icon-wrap").className = tone === "error" ? "dialog-icon is-error" : "dialog-icon";
  $("dialog-text").textContent = text;
  $("dialog-close").textContent = tone === "error" ? t("dialog.closeKnown") : t("dialog.closeDone");
  $("success-dialog").show();
  try {
    tg?.HapticFeedback?.notificationOccurred(tone === "error" ? "error" : "success");
  } catch {}
}

function onApproved(result) {
  clearInterval(state.timer);
  showResultDialog({
    title: t("dialog.approved.title"),
    text: t("dialog.approved.text", { chat: result.chatTitle || t("table.group") }),
  });
}

function startCountdown(expiresAt) {
  clearInterval(state.timer);
  const totalMs = Math.max(1, expiresAt - Date.now());
  const tick = () => {
    const left = Math.max(0, expiresAt - Date.now());
    const total = Math.floor(left / 1000);
    const time = `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
    const text = left > 0 ? t("hero.remaining", { time }) : t("hero.expired");
    state.countdownText = time;
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
          <p class="md-typescale-body-medium muted">${esc(t("panel.expiredStandalone"))}</p>
          <div class="panel__actions"><md-filled-tonal-button id="btn-new-challenge">${esc(t("panel.newChallenge"))}</md-filled-tonal-button></div>`;
        $("btn-new-challenge").addEventListener("click", () => loadStandalonePanel());
      } else {
        $("method-panel").innerHTML =
          `<p class="md-typescale-body-medium muted">${esc(t("panel.expiredVerify"))}</p>`;
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
    eyebrow: t("hero.eyebrow"),
    title: t("hero.verifyTitle"),
    sub: "示例群 · Paff 测试群",
    group: { title: "示例群 · Paff 测试群", photo: "./icon-192.png" },
    chips: [{ text: "剩余 05:00", id: "hero-countdown", strong: true }],
  });

  if (params.get("empty") === "1") {
    showState("empty");
    setHero({
      eyebrow: t("hero.eyebrow"),
      title: t("hero.greeting", { name: "Paff" }),
      sub: t("hero.noPendingGroup"),
      chips: [],
    });
    renderBoundAccount({ login: params.get("gh") || "GamerNoTitle" });
    return;
  }

  if (params.get("dialog") === "error") {
    showResultDialog({
      title: "验证没有通过",
      text: "签名对不上这次的原文（原文 5 分钟有效、用一次就作废）。回群里重新申请一份再签。",
      tone: "error",
    });
  }

  const banner = document.createElement("div");
  banner.className = "preview-banner";
  banner.innerHTML = `<md-icon>${svgIcon("error", 20)}</md-icon><span>${esc(
    t("preview.banner", { bot: "P4ffBot" }),
  )}</span>`;
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
  const chatId = ddValue("audit-group");
  $("audit-hint").textContent = t("audit.loading");
  try {
    const query = chatId ? `?chatId=${encodeURIComponent(chatId)}` : "";
    const data = await api(`/api/audit/overview${query}`);
    $("audit-hint").textContent = t("audit.summary", {
      verifications: data.verificationsTotal,
      logs: data.auditTotal,
    });
    renderAudit(data);
    $("token-card").classList.add("hidden");
  } catch (err) {
    $("audit-hint").textContent = t("audit.loadFail", { error: err.message });
    if (err.status === 401) $("token-card").classList.remove("hidden");
  }
}

const ACTION_KEYS = {
  "verification.created": "action.created",
  "verification.approved": "action.approved",
  "verification.declined": "action.declined",
  "verification.timeout": "action.timeout",
  "verification.banned": "action.banned",
  "verification.blocked": "action.blocked",
  "verification.rate_limited": "action.rateLimited",
  "verification.failed": "action.failed",
  "verification.dm_failed": "action.dmFailed",
  "telegram.action_failed": "action.telegramFailed",
  "group.settings": "action.groupSettings",
  "telegram.channel_banned": "action.channelBanned",
  "telegram.bot_banned": "action.botBanned",
  "verification.captcha_passed": "action.captchaPassed",
};

function actionLabel(action) {
  const key = ACTION_KEYS[action];
  return key ? t(key) : action;
}

const ACTOR_KEYS = { user: "actor.user", system: "actor.system", super_admin: "actor.superAdmin", admin: "actor.admin" };
const actorLabel = (type) => (ACTOR_KEYS[type] ? t(ACTOR_KEYS[type]) : type);

const METHOD_KEYS = {
  github: "method.github",
  github_oauth: "method.githubOauth",
  button: "method.button",
  admin_pass: "method.adminPass",
  admin_reject: "method.adminReject",
  profile: "method.profile",
  timeout: "method.timeout",
};

const REASON_KEYS = {
  expired: "reason.expired",
  banned: "reason.banned",
  blocked: "reason.blocked",
  admin_pass: "reason.adminPass",
  admin_reject: "reason.adminReject",
  timeout: "reason.timeout",
  ok: "reason.ok",
};

/** 把 Telegram 的英文报错翻成一句人话。 */
function humanError(raw) {
  if (/user is an admin/i.test(raw)) return t("err.admin");
  if (/not enough rights|CHAT_ADMIN_REQUIRED/i.test(raw)) return t("err.rights");
  if (/user not found|PARTICIPANT_ID_INVALID/i.test(raw)) return t("err.notInGroup");
  if (/message to delete not found/i.test(raw)) return t("err.dmDeleted");
  if (/USER_IS_BLOCKED/i.test(raw)) return t("err.blockedByUser");
  return t("err.telegram");
}

/** 把审计 detail 对象翻成人话，不再直接吐 JSON。 */
function describeDetail(detail) {
  if (!detail || typeof detail !== "object") return "";
  const parts = [];
  if (detail.method) parts.push(METHOD_KEYS[detail.method] ? t(METHOD_KEYS[detail.method]) : detail.method);
  if (detail.reason) parts.push(REASON_KEYS[detail.reason] ? t(REASON_KEYS[detail.reason]) : detail.reason);
  if (detail.scope === "telegram") parts.push(t("detail.scopeJoin"));
  if (detail.mode === "group_join") parts.push(t("detail.modeDirect"));
  if (detail.source === "admin" || detail.selftest) parts.push(t("detail.selftest"));
  if (typeof detail.error === "string") parts.push(humanError(detail.error));
  return parts.join(" · ");
}

const STATUS_TONE = {
  approved: "tone-primary",
  pending: "tone-secondary",
  timeout: "tone-tertiary",
  declined: "tone-tertiary",
  banned: "tone-error",
  blocked: "tone-error",
};

function statusMeta(status) {
  const key = `status.${status}`;
  const label = t(key);
  return { label: label === key ? status : label, tone: STATUS_TONE[status] ?? "" };
}

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
  const label = METHOD_KEYS[method] ? t(METHOD_KEYS[method]) : "";
  return label ? `<span class="cell-sub">${esc(label)}</span>` : "";
}

const auditView = {
  chatId: "",
  verify: { page: 1, status: "", q: "" },
  log: { page: 1, action: "", q: "" },
};

function statusOptions() {
  return [
    ["", t("status.all")],
    ["pending", t("status.pending")],
    ["approved", t("status.approved")],
    ["timeout", t("status.timeout")],
    ["declined", t("status.declined")],
    ["banned", t("status.banned")],
    ["blocked", t("status.blocked")],
  ];
}

function actionOptions() {
  return [
    ["", t("action.all")],
    ["verification.created", t("action.created")],
    ["verification.approved", t("action.approved")],
    ["verification.timeout", t("action.timeout")],
    ["verification.declined", t("action.declined")],
    ["verification.rate_limited", t("action.rateLimited")],
    ["telegram.action_failed", t("action.telegramFailed")],
  ];
}

function ddItemsHtml(options) {
  return options
    .map(([value, label]) => `<button type="button" class="dd__item" role="option" data-value="${esc(value)}">${esc(label)}</button>`)
    .join("");
}

function selectHtml(id, options) {
  return `<div class="dd">
    <button type="button" class="dd__btn" id="${id}" aria-haspopup="listbox" aria-expanded="false"><span class="dd__label">${esc(options[0]?.[1] ?? "")}</span>${svgIcon("chevron", 18)}</button>
    <div class="dd__menu" role="listbox" hidden>${ddItemsHtml(options)}</div>
  </div>`;
}

/** 下拉当前值：直接读写按钮上的 value，原有代码不用改。 */
function ddValue(id) {
  const el = $(id);
  return el?.value ?? "";
}

function setDdValue(idOrEl, value) {
  const btn = typeof idOrEl === "string" ? $(idOrEl) : idOrEl;
  if (!btn) return;
  const menu = btn._menu ?? btn.nextElementSibling;
  const item = menu?.querySelector(`.dd__item[data-value="${value}"]`) ?? menu?.querySelector(".dd__item");
  btn.value = item?.dataset.value ?? "";
  const label = btn.querySelector(".dd__label");
  if (label) label.textContent = item?.textContent ?? "";
  menu?.querySelectorAll(".dd__item").forEach((el) => el.setAttribute("aria-selected", String(el === item)));
  if (menu) menu.hidden = true;
  btn.setAttribute("aria-expanded", "false");
}

function fillDd(id, options, value) {
  const btn = $(id);
  if (!btn) return;
  const menu = btn._menu ?? btn.nextElementSibling;
  if (menu) {
    btn._menu = menu;
    menu.innerHTML = ddItemsHtml(options);
  }
  setDdValue(btn, options.some(([v]) => v === value) ? value : (options[0]?.[0] ?? ""));
}

/* 下拉菜单要逃出卡片的 overflow，打开时挂到 body 上 */
let openDd = null;

function closeDd() {
  if (!openDd) return;
  const { menu, btn } = openDd;
  menu.hidden = true;
  btn.setAttribute("aria-expanded", "false");
  if (menu.parentElement === document.body) btn.parentElement.appendChild(menu);
  openDd = null;
}

function openDdMenu(btn) {
  const menu = btn._menu ?? btn.nextElementSibling;
  if (!menu) return;
  btn._menu = menu;
  if (openDd?.menu === menu) {
    closeDd();
    return;
  }
  closeDd();
  document.body.appendChild(menu);
  menu.hidden = false;                       // 先显示，否则量不到高度
  const rect = btn.getBoundingClientRect();
  menu.style.left = `${Math.round(rect.left)}px`;
  menu.style.minWidth = `${Math.round(rect.width)}px`;
  // 页脚的下拉往下开会跑出屏幕，靠近底部时改成向上展开
  const height = menu.offsetHeight;
  // 页脚的语言下拉固定往上开，免得盖住 copyright
  const openUp = btn.closest(".foot") !== null || rect.bottom + 6 + height > window.innerHeight - 8;
  menu.style.top = `${Math.round(openUp ? Math.max(8, rect.top - height - 6) : rect.bottom + 6)}px`;
  menu._owner = btn;
  btn.setAttribute("aria-expanded", "true");
  openDd = { btn, menu };
}

document.addEventListener("click", (event) => {
  const btn = event.target.closest?.(".dd__btn");
  const item = event.target.closest?.(".dd__item");

  if (item) {
    const menu = item.parentElement;
    const owner = menu?._owner;
    if (owner) {
      setDdValue(owner, item.dataset.value);
      owner.dispatchEvent(new Event("change", { bubbles: true }));
      closeDd();
    }
    return;
  }

  if (btn) {
    openDdMenu(btn);
    return;
  }

  if (openDd && !event.target.closest?.(".dd__menu")) closeDd();
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") closeDd();
});

window.addEventListener("scroll", closeDd, { passive: true });

function groupCell(title, id) {
  if (!title && !id) return '<div class="cell muted">—</div>';
  return `<div class="cell">${esc(title || String(id))}${
    title && id ? `<span class="cell-sub mono">${esc(id)}</span>` : ""
  }</div>`;
}

function verifyRowHtml(row) {
  const meta = statusMeta(row.status);
  const reason = REASON_KEYS[row.reason] ? t(REASON_KEYS[row.reason]) : (row.reason ?? "");
  return `<tr>
    <td data-label="${esc(t("table.time"))}"><div class="cell mono" title="${esc(fmtTimeFull(row.createdAt))}">${fmtTime(row.createdAt)}</div></td>
    <td data-label="${esc(t("table.group"))}">${groupCell(row.chatTitle, row.chatId)}</td>
    <td data-label="${esc(t("table.user"))}"><div class="cell">${esc(row.userName || row.userId)}<span class="cell-sub mono">${esc(row.userId)}</span></div></td>
    <td data-label="${esc(t("table.status"))}"><div class="cell"><span class="status-chip ${meta.tone}">${esc(meta.label)}</span></div></td>
    <td data-label="${esc(t("table.note"))}" class="muted"><div class="cell">${esc(reason)}${methodNote(row)}${
      row.operatorId ? `<span class="cell-sub">${esc(t("table.operator", { id: row.operatorId }))}</span>` : ""
    }</div></td>
  </tr>`;
}

function auditRowHtml(row) {
  return `<tr>
    <td data-label="${esc(t("table.time"))}"><div class="cell mono" title="${esc(fmtTimeFull(row.ts))}">${fmtTime(row.ts)}</div></td>
    <td data-label="${esc(t("table.group"))}">${groupCell(row.chatTitle, row.chatId)}</td>
    <td data-label="${esc(t("table.actor"))}"><div class="cell">${esc(actorLabel(row.actorType))}${
      row.actorId ? `<span class="cell-sub mono">${esc(row.actorId)}</span>` : ""
    }</div></td>
    <td data-label="${esc(t("table.action"))}"><div class="cell">${esc(actionLabel(row.action))}</div></td>
    <td data-label="${esc(t("table.detail"))}" class="muted"><div class="cell">${
      esc(describeDetail(row.detail)) || "—"
    }${row.targetUserId ? `<span class="cell-sub mono">${esc(t("table.target", { id: row.targetUserId }))}</span>` : ""}</div></td>
  </tr>`;
}

function pagerHtml(prefix, page, total, pageSize) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return `<button type="button" class="pager__btn" id="${prefix}-prev" ${page <= 1 ? "disabled" : ""}>${esc(t("pager.prev"))}</button>
    <span class="pager__info">${esc(t("pager.info", { page, pages, total }))}</span>
    <button type="button" class="pager__btn" id="${prefix}-next" ${page >= pages ? "disabled" : ""}>${esc(t("pager.next"))}</button>`;
}

async function loadVerifyPage() {
  const view = auditView.verify;
  const params = new URLSearchParams({ chatId: auditView.chatId, page: String(view.page), pageSize: "20" });
  if (view.status) params.set("status", view.status);
  if (view.q) params.set("q", view.q);

  const tbody = $("v-rows");
  if (!tbody) return;
  tbody.innerHTML = `<tr><td colspan="5" class="muted">${esc(t("audit.loading"))}</td></tr>`;
  try {
    const data = await api(`/api/audit/verifications?${params.toString()}`);
    tbody.innerHTML = data.rows.map(verifyRowHtml).join("") || `<tr><td colspan="5" class="muted">${esc(t("audit.none"))}</td></tr>`;
    $("v-count").textContent = t("audit.rowCount", { total: data.total });
    $("v-pager").innerHTML = pagerHtml("v", data.page, data.total, data.pageSize);
    bindPager("v", "verify", loadVerifyPage);
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="5" class="muted">${esc(t("audit.loadFail", { error: err.message }))}</td></tr>`;
  }
}

async function loadLogPage() {
  const view = auditView.log;
  const params = new URLSearchParams({ chatId: auditView.chatId, page: String(view.page), pageSize: "20" });
  if (view.action) params.set("action", view.action);
  if (view.q) params.set("q", view.q);

  const tbody = $("a-rows");
  if (!tbody) return;
  tbody.innerHTML = `<tr><td colspan="5" class="muted">${esc(t("audit.loading"))}</td></tr>`;
  try {
    const data = await api(`/api/audit/log?${params.toString()}`);
    tbody.innerHTML = data.rows.map(auditRowHtml).join("") || `<tr><td colspan="5" class="muted">${esc(t("audit.none"))}</td></tr>`;
    $("a-count").textContent = t("audit.rowCount", { total: data.total });
    $("a-pager").innerHTML = pagerHtml("a", data.page, data.total, data.pageSize);
    bindPager("a", "log", loadLogPage);
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="5" class="muted">${esc(t("audit.loadFail", { error: err.message }))}</td></tr>`;
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
    ? `<span class="badge ok">${esc(t("audit.chainOk", { count: chain.checked }))}</span>`
    : `<span class="badge bad">${esc(t("audit.chainBad", { index: chain.brokenAtId }))}</span>`;

  auditView.chatId = String(data.chatId ?? "");

  const groupSelect = $("audit-group");
  if (groupSelect) {
    const current = groupSelect.value || auditView.chatId;
    const options = [["", t("audit.groupAll")]].concat(
      (data.groups ?? []).map((g) => [String(g.chatId), g.title || String(g.chatId)]),
    );
    fillDd("audit-group", options, current);
    auditView.chatId = ddValue("audit-group");
  }
  auditView.verify = { page: 1, status: "", q: "" };
  auditView.log = { page: 1, action: "", q: "" };

  $("audit-stats").innerHTML = `
    <div class="card">
      <div class="stats">
        <div class="stat tone-primary">${svgIcon("check", 18)}<b>${Number(stats.approved || 0)}</b><span>${esc(t("stats.approved"))}</span></div>
        <div class="stat tone-secondary">${svgIcon("clock", 18)}<b>${Number(stats.pending || 0)}</b><span>${esc(t("stats.pending"))}</span></div>
        <div class="stat tone-tertiary">${svgIcon("stack", 18)}<b>${Number(stats.timeout || 0) + Number(stats.declined || 0)}</b><span>${esc(t("stats.failed"))}</span></div>
      </div>
      <p class="chain">${chainBadge}</p>
    </div>`;

  $("audit-body").innerHTML = `
    <div class="card">
      <div class="table-head">
        <h2 class="md-typescale-title-medium">${esc(t("audit.verifyTitle"))}</h2>
        <span class="md-typescale-body-small muted" id="v-count"></span>
      </div>
      <div class="toolbar">
        <md-outlined-text-field id="v-q" label="${esc(t("audit.searchVerify"))}"></md-outlined-text-field>
        ${selectHtml("v-status", statusOptions())}
      </div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>${esc(t("table.time"))}</th><th>${esc(t("table.group"))}</th><th>${esc(t("table.user"))}</th><th>${esc(t("table.status"))}</th><th>${esc(t("table.note"))}</th></tr></thead>
          <tbody id="v-rows"></tbody>
        </table>
      </div>
      <div class="pager" id="v-pager"></div>
    </div>
    <div class="card">
      <div class="table-head">
        <h2 class="md-typescale-title-medium">${esc(t("audit.logTitle"))}</h2>
        <span class="md-typescale-body-small muted" id="a-count"></span>
      </div>
      <div class="toolbar">
        <md-outlined-text-field id="a-q" label="${esc(t("audit.searchLog"))}"></md-outlined-text-field>
        ${selectHtml("a-action", actionOptions())}
      </div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>${esc(t("table.time"))}</th><th>${esc(t("table.group"))}</th><th>${esc(t("table.actor"))}</th><th>${esc(t("table.action"))}</th><th>${esc(t("table.detail"))}</th></tr></thead>
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
    apply(el.value ?? "");
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
  const chatId = ddValue("audit-group");
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
    toast(t("audit.csvStarted"));
  } catch (err) {
    $("audit-hint").textContent = t("audit.exportFail", { error: err.message });
  }
}


/* ---------------------------------------------------------------- 运行配置 */

const settingsState = { fields: [], cleared: new Set(), busy: false };

const SETTINGS_GROUPS = ["basic", "verify", "github", "captcha"];

async function loadSettings() {
  const form = $("settings-form");
  form.innerHTML = `<p class="md-typescale-body-medium muted">${esc(t("settings.saving"))}</p>`;
  try {
    const data = await api("/api/admin/settings");
    settingsState.fields = data.fields ?? [];
    settingsState.cleared = new Set();
    renderSettings();
  } catch (err) {
    form.innerHTML = `<p class="captcha__err">${esc(err.message)}</p>`;
  }
}

function settingsFieldHtml(field) {
  const key = esc(field.key);
  const hint = field.hintKey ? `<p class="settings__hint">${esc(t(field.hintKey))}</p>` : "";

  if (field.type === "bool") {
    const on = (field.value || field.effective) === "true";
    return `<div class="settings__row settings__row--switch">
      <span class="settings__label">${key}</span>
      <md-switch data-key="${key}" data-type="bool" ${on ? "selected" : ""} aria-label="${key}"></md-switch>
      ${hint}
    </div>`;
  }

  if (field.type === "enum") {
    const options = field.options ?? [];
    const buttons = options
      .map(
        (opt) =>
          `<button type="button" data-val="${esc(opt)}" aria-selected="${opt === (field.value || field.effective)}">${esc(opt || t("settings.auto"))}</button>`,
      )
      .join("");
    return `<div class="settings__row">
      <span class="settings__label">${key}</span>
      <div class="segmented segmented--sm settings__enum" data-key="${key}" data-type="enum">${buttons}</div>
      ${hint}
    </div>`;
  }

  if (field.secret) {
    return `<div class="settings__row">
      <span class="settings__label">${key}</span>
      <input class="settings__input" type="password" data-key="${key}" data-type="secret" data-secret="1"
        placeholder="${esc(field.hasValue ? t("settings.secretSet") : "")}" value="" autocomplete="new-password" />
      ${field.hasValue ? `<button type="button" class="settings__clear" data-clear="${key}">${esc(t("settings.clear"))}</button>` : ""}
      ${hint}
    </div>`;
  }

  if (field.readOnly) {
    return `<div class="settings__row">
      <span class="settings__label">${key}</span>
      <div class="settings__readonly">
        <input class="settings__input" type="text" readonly value="${esc(field.value ?? "")}" data-key="${key}" />
        <button type="button" class="settings__round" data-copy="${esc(field.value ?? "")}" title="${esc(t("settings.copy"))}">⧉</button>
      </div>
      ${hint}
    </div>`;
  }

  if (field.type === "intList") {
    const values = String(field.value || "").split(",").map((v) => v.trim()).filter(Boolean);
    const rows = (values.length > 0 ? values : [""]).map(intListRowHtml).join("");
    return `<div class="settings__row">
      <span class="settings__label">${key}</span>
      <div class="settings__list" data-key="${key}" data-type="intList">${rows}</div>
      ${hint}
    </div>`;
  }

  const inputType = field.type === "int" ? "number" : field.type === "url" ? "url" : "text";
  const range = field.type === "int" ? ` min="${field.min ?? ""}" max="${field.max ?? ""}"` : "";
  return `<div class="settings__row">
    <span class="settings__label">${key}</span>
    <input class="settings__input" type="${inputType}"${range} data-key="${key}" data-type="${esc(field.type)}"
      value="${esc(field.value ?? "")}"
      placeholder="${esc(field.value || !field.effective ? "" : t("settings.default", { value: field.effective }))}" />
    ${hint}
  </div>`;
}

/** intList 的一行：末尾加号追加，第二行起多一个减号删除自己。 */
function intListRowHtml(value, index) {
  return `<div class="settings__list-row">
    <input class="settings__input" type="text" inputmode="numeric" data-list-input value="${esc(value ?? "")}" />
    <button type="button" class="settings__round" data-add title="${esc(t("settings.add"))}">+</button>
    ${index > 0 ? `<button type="button" class="settings__round settings__round--minus" data-del title="${esc(t("settings.remove"))}">−</button>` : ""}
  </div>`;
}

/** 重画整个列表，保证「加号只多不少、减号只从第二行起」这些规则不用到处补。 */
function renderIntList(list, values, focusIndex) {
  list.querySelectorAll(".settings__list-row").forEach((row) => row.remove());
  const rows = (values.length > 0 ? values : [""]).map(intListRowHtml).join("");
  list.insertAdjacentHTML("beforeend", rows);
  if (focusIndex !== undefined) {
    const input = list.querySelectorAll("input[data-list-input]")[focusIndex];
    input?.focus();
    input?.setSelectionRange?.(input.value.length, input.value.length);
  }
}

function wireIntLists(form) {
  for (const list of form.querySelectorAll(".settings__list")) {
    const read = () => [...list.querySelectorAll("input[data-list-input]")].map((el) => el.value.trim());

    list.addEventListener("click", (event) => {
      const add = event.target.closest("[data-add]");
      const del = event.target.closest("[data-del]");
      if (!add && !del) return;

      const row = (add ?? del).closest(".settings__list-row");
      const index = [...list.querySelectorAll(".settings__list-row")].indexOf(row);
      const values = read();

      if (add) {
        values.splice(index + 1, 0, "");
        renderIntList(list, values, index + 1);
        return;
      }

      if (values.length <= 1) return;
      values.splice(index, 1);
      renderIntList(list, values, Math.max(0, index - 1));
    });
  }
}

function renderSettings() {
  const form = $("settings-form");
  let html = "";
  for (const group of SETTINGS_GROUPS) {
    const fields = settingsState.fields.filter((f) => f.group === group);
    if (fields.length === 0) continue;
    html += `<h3 class="settings__group">${esc(t(`settings.group.${group}`))}</h3>`;
    html += fields.map(settingsFieldHtml).join("");
  }
  form.innerHTML = html;

  for (const en of form.querySelectorAll(".settings__enum")) {
    for (const button of en.querySelectorAll("button")) {
      button.addEventListener("click", () => {
        for (const other of en.querySelectorAll("button")) {
          other.setAttribute("aria-selected", String(other === button));
        }
      });
    }
  }
  wireIntLists(form);

  for (const button of form.querySelectorAll("[data-copy]")) {
    button.addEventListener("click", async () => {
      const text = button.dataset.copy ?? "";
      try {
        await navigator.clipboard.writeText(text);
      } catch {
        const input = button.closest(".settings__readonly")?.querySelector("input");
        input?.select();
        document.execCommand?.("copy");
      }
      window.getSelection?.()?.removeAllRanges();
      button.textContent = "✓";
      setTimeout(() => {
        button.textContent = "⧉";
      }, 1200);
    });
  }

  for (const button of form.querySelectorAll("[data-clear]")) {
    button.addEventListener("click", () => {
      const key = button.dataset.clear;
      settingsState.cleared.add(key);
      const input = form.querySelector(`input[data-key="${key}"]`);
      if (input) {
        input.value = "";
        input.placeholder = "";
      }
      $("settings-hint").textContent = "";
    });
  }
  $("settings-save").removeAttribute("disabled");
}

function collectSettings() {
  const values = {};
  for (const field of settingsState.fields) {
    if (field.readOnly) continue;
    if (field.type === "bool") {
      const el = document.querySelector(`md-switch[data-key="${field.key}"]`);
      values[field.key] = el?.selected ? "true" : "false";
      continue;
    }
    if (field.type === "enum") {
      const active = document.querySelector(`.settings__enum[data-key="${field.key}"] button[aria-selected="true"]`);
      values[field.key] = active?.dataset.val ?? "";
      continue;
    }
    if (field.readOnly) {
      return `<div class="settings__row">
      <span class="settings__label">${key}</span>
      <div class="settings__readonly">
        <input class="settings__input" type="text" readonly value="${esc(field.value ?? "")}" data-key="${key}" />
        <button type="button" class="settings__round" data-copy="${esc(field.value ?? "")}" title="${esc(t("settings.copy"))}">⧉</button>
      </div>
      ${hint}
    </div>`;
    }

    if (field.type === "intList") {
      const list = document.querySelector(`.settings__list[data-key="${field.key}"]`);
      const ids = [...(list?.querySelectorAll("input[data-list-input]") ?? [])]
        .map((el) => el.value.trim())
        .filter(Boolean);
      values[field.key] = ids.join(",");
      continue;
    }

    const el = document.querySelector(`input[data-key="${field.key}"]`);
    const raw = (el?.value ?? "").trim();
    if (field.secret) {
      // 留空表示不修改；只有点了「清除」才显式清空
      if (raw === "" && !settingsState.cleared.has(field.key)) continue;
      values[field.key] = raw;
      continue;
    }
    values[field.key] = raw;
  }
  return values;
}

/** 前端先拦一遍，规则和后端一致，省得每次都要往返。 */
function checkSettings(values) {
  for (const field of settingsState.fields) {
    if (!(field.key in values)) continue;
    const raw = values[field.key];
    if (field.key === "ADMIN_IDS" && raw.split(/[,\s]+/).filter(Boolean).length === 0) {
      return t("settings.needAdmin");
    }
    if (field.type === "int" && raw !== "") {
      if (!/^\d+$/.test(raw)) return `${field.key}: ${t("settings.invalid")}`;
      const n = Number.parseInt(raw, 10);
      if (field.min !== null && n < field.min) return `${field.key} ≥ ${field.min}`;
      if (field.max !== null && n > field.max) return `${field.key} ≤ ${field.max}`;
    }
    if (field.type === "intList" && raw !== "" && !raw.split(/[,\s]+/).every((v) => /^\d+$/.test(v))) {
      return `${field.key}: ${t("settings.invalid")}`;
    }
    if (field.type === "url" && raw !== "" && !/^https?:\/\//i.test(raw)) {
      return `${field.key}: ${t("settings.invalid")}`;
    }
  }

  // 人机验证：开了必须有方式，且必填项不能空
  const enabled = values.CAPTCHA_ENABLED ?? (settingsState.fields.find((f) => f.key === "CAPTCHA_ENABLED")?.effective ?? "false");
  if (enabled === "true") {
    const provider = values.CAPTCHA_PROVIDER ?? "";
    if (!provider) return t("settings.error.captchaProvider");
    const empty = (key) => {
      const value = values[key];
      if (value !== undefined) return value.trim() === "";
      return !settingsState.fields.find((f) => f.key === key)?.hasValue;
    };
    if (provider === "cap" && empty("CAPTCHA_URL")) return t("settings.error.captchaConfig");
    if (provider === "turnstile" && (empty("TURNSTILE_SITE_KEY") || empty("TURNSTILE_SECRET"))) {
      return t("settings.error.captchaConfig");
    }
  }
  return "";
}

async function saveSettings() {
  if (settingsState.busy) return;
  const values = collectSettings();
  const problem = checkSettings(values);
  if (problem) {
    $("settings-hint").textContent = problem;
    return;
  }

  settingsState.busy = true;
  $("settings-save").setAttribute("disabled", "");
  $("settings-hint").textContent = t("settings.saving");
  try {
    await api("/api/admin/settings", { method: "PUT", body: { values } });
    $("settings-hint").textContent = t("settings.saved");
    await loadSettings();
  } catch (err) {
    $("settings-hint").textContent = err.errorKey ? t(err.errorKey) : err.message;
  } finally {
    settingsState.busy = false;
    $("settings-save").removeAttribute("disabled");
  }
}

$("settings-save").addEventListener("click", () => void saveSettings());

/* ---------------------------------------------------------------- 初始化 */

/** 审计只给管理员：Mini App 里 superAdmin，或网页端直接访问 /admin。 */
function applyNavVisibility() {
  const isAdmin = state.superAdmin || location.pathname === "/admin" || params.get("admin") === "1";
  const auditButton = $("nav").querySelector('button[data-view="audit"]');
  if (auditButton) auditButton.classList.toggle("hidden", !isAdmin);
  const settingsButton = $("nav").querySelector('button[data-view="settings"]');
  if (settingsButton) settingsButton.classList.toggle("hidden", !state.superAdmin);
  if (isAdmin && location.pathname === "/admin") switchTab("audit");
}

function switchTab(name) {
  $("view-verify").classList.toggle("hidden", name !== "verify");
  $("view-audit").classList.toggle("hidden", name !== "audit");
  $("view-settings").classList.toggle("hidden", name !== "settings");
  if (name === "settings" && settingsState.fields.length === 0) void loadSettings();
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

$("empty-icon").innerHTML = svgIcon("inbox", 34);

/** 版权：起始年固定，跨年后自动变成区间。 */
function renderFooter() {
  const START_YEAR = 2026;
  const year = new Date().getFullYear();
  const range = year > START_YEAR ? `${START_YEAR} - ${year}` : `${START_YEAR}`;
  $("foot").innerHTML =
    `©️ ${range} <a href="https://bili33.top" target="_blank" rel="noreferrer">GamerNoTitle</a>` +
    ` · <a href="https://github.com/GamerNoTitle/Paffbot" target="_blank" rel="noreferrer">${esc(t("app.name"))}</a>` +
    ` · <a href="https://github.com/GamerNoTitle/Paffbot" target="_blank" rel="noreferrer">${esc(t("foot.repo"))}</a>`;
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
  loadAudit();
});

/* ---------------------------------------------------------------- i18n */


document.querySelectorAll(".dd__btn").forEach((btn) => {
  if (!btn.querySelector("svg")) btn.insertAdjacentHTML("beforeend", svgIcon("chevron", 18));
});

function initI18n() {
  const lang = setLang(detectLang(TG_LANG));
  applyStaticI18n();
  document.title = t("page.title");

  const select = $("lang");
  if (!select) return;
  fillDd("lang", LANGUAGES.map(([code, label]) => [code, label]), lang);
  select.addEventListener("change", () => {
    setLang(select.value);
    retranslate();
  });
}

/** 切语言只重画文案：不重新请求，也不丢已经填进去的用户名和签名。 */
function retranslate() {
  document.title = t("page.title");
  applyStaticI18n();
  renderFooter();

  if (!$("view-settings").classList.contains("hidden")) {
    if (settingsState.fields.length > 0) renderSettings();
    return;
  }

  if (!$("view-audit").classList.contains("hidden")) {
    loadAudit();
    return;
  }

  if (state.standalone && !$("pending").classList.contains("hidden")) {
    if (state.standaloneData) {
      const typed = {
        username: $("gh-username")?.value ?? "",
        signature: $("gh-signature")?.value ?? "",
      };
      setHero({
        eyebrow: t("app.name"),
        title: t("hero.verifyTitle"),
        sub: t("panel.ssh.desc"),
        chips: [
          ...(state.standaloneRemaining !== null
            ? [{ text: t("hero.attemptsLeft", { count: state.standaloneRemaining }) }]
            : []),
          { text: t("hero.remaining", { time: state.countdownText || "05:00" }), id: "hero-countdown", strong: true },
        ],
      });
      renderGithubPanel($("method-panel"), { challenge: state.standaloneData.challenge, requirements: {} }, "standalone");
      if ($("gh-username")) $("gh-username").value = typed.username;
      if ($("gh-signature")) $("gh-signature").value = typed.signature;
      const submit = $("gh-submit");
      if (submit && typed.username && typed.signature) submit.disabled = false;
    }
    return;
  }

  const pending = state.verification && !$("pending").classList.contains("hidden");
  if (pending) {
    setHero({
      eyebrow: t("hero.eyebrow"),
      title: t("hero.verifyTitle"),
      group: {
        title: state.verification.chatTitle ?? String(state.verification.chatId),
        photo: state.verification.chatPhoto || "",
      },
      chips: [
        { text: t("hero.remaining", { time: state.countdownText || "00:00" }), id: "hero-countdown", strong: true },
      ],
    });

    if (state.panelData) {
      const typed = {
        username: $("gh-username")?.value ?? "",
        signature: $("gh-signature")?.value ?? "",
      };
      renderMethodPanel($("method-panel"), state.panelData);
      if ($("gh-username")) $("gh-username").value = typed.username;
      if ($("gh-signature")) $("gh-signature").value = typed.signature;
      const submit = $("gh-submit");
      if (submit && typed.username && typed.signature) submit.disabled = false;
    }
    return;
  }

  const name = state.session?.user?.name?.split(" ")[0];
  setHero({
    eyebrow: t("hero.eyebrow"),
    title: name ? t("hero.greeting", { name }) : t("hero.noPending"),
    sub: t("hero.noPendingGroup"),
    chips: [],
  });
  $("empty-title").textContent = t("empty.title");
  $("empty-text").textContent = t("empty.text");
  renderBoundAccount(state.github);
}

initI18n();
applyNavVisibility();
loadSession();
