export type SessionRoute = {
  sessionId: string | null;
  normalizedPath: string;
  valid: boolean;
};

function trimTrailingSlash(routePath: string): string {
  if (routePath.length > 1 && routePath.endsWith("/")) {
    return routePath.slice(0, -1);
  }
  return routePath;
}

function normalizeInputToRoutePath(input: string): string {
  const raw = (input || "").trim();
  if (!raw || raw === "#") return "/chat";

  if (raw.startsWith("#")) {
    const hashPath = raw.slice(1);
    if (!hashPath || hashPath === "/") return "/chat";
    return hashPath.startsWith("/") ? hashPath : `/${hashPath}`;
  }

  if (raw === "/" || raw === "/index.html") return "/chat";
  return raw;
}

export function buildSessionPath(sessionId?: string | null): string {
  const normalized = sessionId?.trim();
  if (!normalized) return "/chat";
  return `/chat/${encodeURIComponent(normalized)}`;
}

export function parseSessionRoute(pathname: string): SessionRoute {
  const routePath = normalizeInputToRoutePath(pathname);
  const cleanPath = trimTrailingSlash(routePath);

  if (cleanPath === "/chat") {
    return {
      sessionId: null,
      normalizedPath: buildSessionPath(null),
      valid: true,
    };
  }

  if (cleanPath.startsWith("/chat/")) {
    const suffix = cleanPath.slice("/chat/".length);
    if (!suffix || suffix.includes("/")) {
      return {
        sessionId: null,
        normalizedPath: buildSessionPath(null),
        valid: false,
      };
    }
    let decoded: string;
    try {
      decoded = decodeURIComponent(suffix);
    } catch {
      return {
        sessionId: null,
        normalizedPath: buildSessionPath(null),
        valid: false,
      };
    }
    return {
      sessionId: decoded,
      normalizedPath: buildSessionPath(decoded),
      valid: true,
    };
  }

  return {
    sessionId: null,
    normalizedPath: buildSessionPath(null),
    valid: false,
  };
}

export function pushSessionPath(sessionId?: string | null): void {
  window.history.pushState({}, "", `#${buildSessionPath(sessionId)}`);
}

export function replaceSessionPath(sessionId?: string | null): void {
  window.history.replaceState({}, "", `#${buildSessionPath(sessionId)}`);
}
