export function getOrCreateOwnerId(): string {
  if (typeof window === "undefined") {
    return "local-dev";
  }
  const key = "codecollab_owner_id";
  let id = window.localStorage.getItem(key);
  if (!id) {
    id = crypto.randomUUID();
    window.localStorage.setItem(key, id);
  }
  return id;
}

export function getDisplayName(): string {
  if (typeof window === "undefined") {
    return "Guest";
  }
  const custom = window.localStorage.getItem("codecollab_display_name");
  if (custom?.trim()) {
    return custom.trim();
  }
  const id = getOrCreateOwnerId();
  return `Guest-${id.slice(0, 8)}`;
}

export function colorFromString(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) {
    h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  }
  const hue = h % 360;
  return `hsl(${hue} 65% 45%)`;
}
