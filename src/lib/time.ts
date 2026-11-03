export function nowMs(): number {
  return Date.now();
}

export function toUnixSeconds(ms: number): number {
  return Math.floor(ms / 1000);
}

export function formatDuration(seconds: number): string {
  if (seconds % 3600 === 0) return `${seconds / 3600} 小时`;
  if (seconds % 60 === 0) return `${seconds / 60} 分钟`;
  return `${seconds} 秒`;
}

export function formatDateTime(ms: number): string {
  // 固定用 UTC+8 展示，审计页面上比 ISO 串好读；数据库里始终是 epoch ms。
  const d = new Date(ms + 8 * 3600 * 1000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`;
}
