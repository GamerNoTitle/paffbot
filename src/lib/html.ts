export function escapeHtml(input: string): string {
  return input.replace(/[&<>"']/g, (ch) => {
    switch (ch) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      default:
        return "&#39;";
    }
  });
}

export function displayName(user: { first_name?: string; last_name?: string; username?: string; id: number }): string {
  const full = [user.first_name, user.last_name].filter(Boolean).join(" ").trim();
  if (full) return full;
  if (user.username) return `@${user.username}`;
  return `用户 ${user.id}`;
}

export function truncate(text: string, max = 64): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}
