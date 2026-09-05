const ALLOWED_EXTERNAL_PROTOCOLS = new Set(["http:", "https:"]);

function parseURL(raw: string, base?: URL): URL | null {
  const trimmed = raw.trim();
  if (!trimmed) {
    return null;
  }

  try {
    const parsed = base ? new URL(trimmed, base) : new URL(trimmed);
    if (!ALLOWED_EXTERNAL_PROTOCOLS.has(parsed.protocol)) {
      return null;
    }
    if (!parsed.hostname) {
      return null;
    }

    return parsed;
  } catch {
    return null;
  }
}

export function toSafeExternalUrl(raw: string | null | undefined): string | null {
  if (!raw) {
    return null;
  }

  return parseURL(raw)?.href ?? null;
}

export function resolveSafeExternalUrl(
  raw: string | null | undefined,
  baseUrl: string | null | undefined,
): string | null {
  if (!raw) {
    return null;
  }

  const safeBase = baseUrl ? parseURL(baseUrl) : null;
  return parseURL(raw, safeBase ?? undefined)?.href ?? null;
}

export function openExternalUrl(raw: string | null | undefined): void {
  const safe = toSafeExternalUrl(raw);
  if (!safe) return;

  if (typeof window !== "undefined" && (window as any).webkit?.messageHandlers?.openExternal) {
    (window as any).webkit.messageHandlers.openExternal.postMessage(safe);
  } else {
    window.open(safe, "_blank", "noopener,noreferrer");
  }
}

export function openMailtoUrl(mailtoUrl: string): void {
  const trimmed = mailtoUrl.trim();
  if (!trimmed.toLowerCase().startsWith("mailto:")) return;

  if (typeof window !== "undefined" && (window as any).webkit?.messageHandlers?.openExternal) {
    (window as any).webkit.messageHandlers.openExternal.postMessage(trimmed);
  } else {
    window.location.href = trimmed;
  }
}
