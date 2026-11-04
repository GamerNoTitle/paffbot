import { fingerprintOf, parsePublicKeyLine } from "./ssh/keys";

/**
 * GitHub 侧的身份锚点：用户在 GitHub 账号里添加的公开 SSH 公钥。
 *
 * 关键点：只读 github.com/<user>.keys（纯文本、无需鉴权、不受 API 限流），
 * 不做 OAuth、不要 scope、不碰用户私有数据。
 */

const USERNAME_RE = /^[a-z\d](?:[a-z\d-]{0,37}[a-z\d])?$/i;

/** 这些名字不是真实用户页（/xxx.keys 会落到别处） */
const RESERVED = new Set([
  "github",
  "api",
  "admin",
  "root",
  "support",
  "help",
  "security",
  "settings",
  "login",
  "logout",
  "signup",
  "orgs",
  "users",
  "repositories",
  "marketplace",
  "explore",
  "topics",
  "collections",
  "sponsors",
  "notifications",
  "issues",
  "pulls",
  "codespaces",
  "account",
  "about",
  "pricing",
]);

export function normalizeGithubUsername(raw: string): string {
  return raw.trim().replace(/^@/, "");
}

export function isValidGithubUsername(name: string): boolean {
  return USERNAME_RE.test(name) && !RESERVED.has(name.toLowerCase());
}

export interface GithubKey {
  raw: string;
  type: string;
  fingerprint: string;
  /** WebCrypto 能否校验（sk-* 硬件密钥不行） */
  supported: boolean;
}

const UA = "paffbot (+https://github.com/GamerNoTitle/paffbot)";

export async function fetchGithubKeys(username: string, token: string | null): Promise<GithubKey[]> {
  const url = `https://github.com/${encodeURIComponent(username)}.keys`;
  const res = await fetch(url, {
    headers: { "user-agent": UA, accept: "text/plain" },
    redirect: "follow",
  });
  if (res.status === 404) throw new Error(`找不到 GitHub 用户 ${username}`);
  if (!res.ok) throw new Error(`读取 GitHub 公钥失败（HTTP ${res.status}）`);

  const text = await res.text();
  const keys: GithubKey[] = [];
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const parsed = parsePublicKeyLine(trimmed);
      keys.push({
        raw: trimmed,
        type: parsed.type,
        fingerprint: await fingerprintOf(parsed.blob),
        supported: true,
      });
    } catch {
      keys.push({
        raw: trimmed,
        type: trimmed.split(/\s+/)[0] ?? "unknown",
        fingerprint: "",
        supported: false,
      });
    }
  }
  return keys;
}

export interface GithubProfile {
  login: string;
  createdAt: number;
  publicRepos: number;
}

async function githubApi(path: string, token: string | null): Promise<unknown> {
  const res = await fetch(`https://api.github.com${path}`, {
    headers: {
      "user-agent": UA,
      accept: "application/vnd.github+json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
  });
  if (res.status === 404) throw new Error("GitHub 用户不存在");
  if (res.status === 403) throw new Error("GitHub API 触发限流，请稍后再试（或给 Worker 配 GITHUB_TOKEN）");
  if (!res.ok) throw new Error(`GitHub API 请求失败（HTTP ${res.status}）`);
  return res.json();
}

export async function fetchGithubProfile(username: string, token: string | null): Promise<GithubProfile> {
  const data = (await githubApi(`/users/${encodeURIComponent(username)}`, token)) as {
    login?: string;
    created_at?: string;
    public_repos?: number;
  };
  const createdAt = data.created_at ? Date.parse(data.created_at) : Number.NaN;
  if (!Number.isFinite(createdAt)) throw new Error("GitHub 返回的账号信息不完整");
  return {
    login: data.login ?? username,
    createdAt,
    publicRepos: data.public_repos ?? 0,
  };
}

export async function isOrgMember(username: string, org: string, token: string | null): Promise<boolean> {
  const data = (await githubApi(`/users/${encodeURIComponent(username)}/orgs?per_page=100`, token)) as unknown;
  if (!Array.isArray(data)) return false;
  return data.some((item) => {
    const login = (item as { login?: unknown }).login;
    return typeof login === "string" && login.toLowerCase() === org.toLowerCase();
  });
}
