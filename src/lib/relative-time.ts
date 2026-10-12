/** "just now", "5 min ago", "3 h ago", "Yesterday", or the date -- for lists people scan. */
export function relativeTime(iso: string, now = Date.now()): string {
  const at = Date.parse(iso);
  if (Number.isNaN(at)) return "";
  const minutes = Math.round((now - at) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24 && new Date(at).getDate() === new Date(now).getDate()) return `${hours} h ago`;
  const date = new Date(at);
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) return "Yesterday";
  return date.toLocaleDateString([], { month: "short", day: "numeric",
    year: date.getFullYear() === new Date(now).getFullYear() ? undefined : "numeric" });
}
