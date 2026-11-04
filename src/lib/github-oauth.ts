import type { Config } from "../env";

/** GitHub OAuth（Authorization Code）：只读公开资料，不碰私有仓库。 */
const AUTHORIZE = "https://github.com/login/oauth/authorize";
const TOKEN = "https://github.com/login/oauth/access_token";
const USER = "https://api.github.com/user";

export interface GithubAccount {
  id: number;
  login: string;
}

export function oauthEnabled(config: Config): boolean {
  return Boolean(config.oauthClientId && config.oauthSecret);
}

export function authorizeUrl(config: Config, state: string, redirectUri: string): string {
  const params = new URLSearchParams({
    client_id: config.oauthClientId ?? "",
    redirect_uri: redirectUri,
    scope: "read:user",
    state,
    allow_signup: "true",
  });
  return `${AUTHORIZE}?${params.toString()}`;
}

export async function exchangeCode(
  config: Config,
  code: string,
  redirectUri: string,
): Promise<string | null> {
  const res = await fetch(TOKEN, {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify({
      client_id: config.oauthClientId,
      client_secret: config.oauthSecret,
      code,
      redirect_uri: redirectUri,
    }),
  });
  if (!res.ok) return null;
  const data = (await res.json()) as { access_token?: string; error?: string };
  return data.access_token ?? null;
}

export async function fetchGithubAccount(token: string): Promise<GithubAccount | null> {
  const res = await fetch(USER, {
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${token}`,
      "user-agent": "paffbot",
    },
  });
  if (!res.ok) return null;
  const data = (await res.json()) as { id?: number; login?: string };
  if (typeof data.id !== "number" || typeof data.login !== "string") return null;
  return { id: data.id, login: data.login };
}
