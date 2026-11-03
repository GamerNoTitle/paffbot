/**
 * 入群资料筛查。原版 YumeBot 会拦"无头像 / 乱码昵称 / 诈骗关键词"，
 * 这里保留最不容易误伤的一条：关键词命中即拦。头像检查需要额外 API 调用，
 * 且对正常用户误伤概率高，默认不做（审计里能看到被拦原因）。
 */

export interface ScreenInput {
  firstName: string;
  lastName?: string;
  username?: string;
  bio?: string;
}

export interface ScreenResult {
  blocked: boolean;
  reason?: string;
}

export function screenProfile(input: ScreenInput, keywords: string[]): ScreenResult {
  const haystack = [input.firstName, input.lastName, input.username, input.bio]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  for (const keyword of keywords) {
    if (keyword && haystack.includes(keyword)) {
      return { blocked: true, reason: `keyword:${keyword}` };
    }
  }
  return { blocked: false };
}
