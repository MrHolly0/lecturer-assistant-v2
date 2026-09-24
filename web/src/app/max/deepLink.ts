const configuredBotName = import.meta.env.VITE_MAX_BOT_NAME?.trim() ?? "";

export function buildMaxJoinUrl(joinCode: string): string | null {
  return buildMaxStartUrl(joinCode);
}

export function buildMaxLinkUrl(code: string): string | null {
  const normalizedCode = normalizeLinkCode(code);
  return normalizedCode ? buildMaxStartUrl(`link-${normalizedCode}`) : null;
}

export function readMaxLinkCode(startParam: string | null): string | null {
  const match = startParam?.match(/^link-([A-Za-z0-9]{6})$/i);
  return match ? match[1].toUpperCase() : null;
}

export function normalizeLinkCode(code: string): string {
  return code
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 6);
}

function buildMaxStartUrl(startParam: string): string | null {
  if (!configuredBotName || !startParam) return null;
  const botName = configuredBotName
    .replace(/^https?:\/\/max\.ru\//i, "")
    .replace(/^@/, "")
    .split(/[/?#]/, 1)[0];
  if (!botName) return null;
  return `https://max.ru/${botName}?startapp=${encodeURIComponent(startParam)}`;
}
