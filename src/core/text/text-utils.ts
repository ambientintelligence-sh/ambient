export function normalizeText(text: string): string {
  return text.trim().replace(/\s+/g, " ");
}

const TASK_STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "the",
  "to",
  "for",
  "of",
  "in",
  "on",
  "at",
  "by",
  "with",
  "from",
  "that",
  "this",
  "is",
  "be",
  "are",
  "should",
  "need",
  "needs",
  "please",
  "todo",
  "task",
  "remind",
  "me",
]);

export function normalizeTaskText(text: string): string {
  return text
    .toLowerCase()
    .replace(/\b(\d+)(am|pm)\b/g, "$1 $2")
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function canonicalizeTaskToken(token: string): string {
  if (!token) return token;
  if (/^[a-z]{5,}es$/.test(token)) return token.slice(0, -2);
  if (/^[a-z]{4,}s$/.test(token)) return token.slice(0, -1);
  return token;
}

function taskTokenSet(text: string): Set<string> {
  const normalized = normalizeTaskText(text);
  if (!normalized) return new Set();
  return new Set(
    normalized
      .split(" ")
      .map((token) => canonicalizeTaskToken(token.trim()))
      .filter((token) => token.length > 1 && !TASK_STOP_WORDS.has(token))
  );
}

export function isLikelyDuplicateTaskText(left: string, right: string): boolean {
  const a = normalizeTaskText(left);
  const b = normalizeTaskText(right);

  if (!a || !b) return false;
  if (a === b) return true;

  // Strong containment for longer strings catches minor phrasing changes.
  if ((a.length >= 16 && b.includes(a)) || (b.length >= 16 && a.includes(b))) {
    return true;
  }

  const aTokens = taskTokenSet(a);
  const bTokens = taskTokenSet(b);
  if (aTokens.size === 0 || bTokens.size === 0) return false;

  let overlap = 0;
  for (const token of aTokens) {
    if (bTokens.has(token)) overlap++;
  }
  if (overlap === 0) return false;

  const minSize = Math.min(aTokens.size, bTokens.size);
  const unionSize = aTokens.size + bTokens.size - overlap;
  const containment = overlap / minSize;
  const jaccard = overlap / unionSize;

  if (containment >= 1 && minSize >= 2) return true;
  if (containment >= 0.8 && overlap >= 3) return true;
  if (jaccard >= 0.6 && overlap >= 3) return true;

  return false;
}

export function cleanTranslationOutput(text: string): string {
  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length === 0) return "";
  const filtered = lines.filter(
    (line) =>
      !/^#/.test(line) &&
      !/^translation\b/i.test(line) &&
      !/^explanation\b/i.test(line) &&
      !/^breakdown\b/i.test(line)
  );
  const candidate = (filtered[0] ?? lines[0]).trim();
  return candidate.replace(/^[-\u2013\u2014]\s+/, "");
}

export function normalizeProviderErrorMessage(message: string): string {
  const normalized = message.trim();
  if (/^user not found\.?$/i.test(normalized)) {
    return "OpenRouter request failed with 'User not found'. This can be caused by an OpenRouter outage or an invalid OPENROUTER_API_KEY.";
  }
  return message;
}

function isGenericProviderErrorMessage(message: string): boolean {
  return /^provider returned error\.?$/i.test(message.trim());
}

function extractErrorMessage(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;

  const record = value as Record<string, unknown>;
  const direct = [record.message, record.error_description, record.detail];
  for (const candidate of direct) {
    if (typeof candidate === "string" && candidate.trim()) {
      const normalized = candidate.trim();
      if (!isGenericProviderErrorMessage(normalized)) {
        return normalized;
      }
    }
  }

  const err = record.error;
  if (typeof err === "string" && err.trim() && !isGenericProviderErrorMessage(err.trim())) return err.trim();
  if (err && typeof err === "object") {
    const nested = extractErrorMessage(err);
    if (nested) return nested;
  }

  if (Array.isArray(record.errors)) {
    for (const item of record.errors) {
      const nested = extractErrorMessage(item);
      if (nested) return nested;
    }
  }

  const raw = record.raw;
  if (typeof raw === "string" && raw.trim()) {
    const nested = extractErrorMessageFromBody(raw);
    if (nested) return nested;
  }

  const metadata = record.metadata;
  if (metadata && typeof metadata === "object") {
    const nested = extractErrorMessage(metadata);
    if (nested) return nested;
  }

  return null;
}

function extractErrorMessageFromBody(value: unknown): string | null {
  if (!value) return null;

  if (typeof value === "string") {
    const text = value.trim();
    if (!text) return null;
    try {
      return extractErrorMessage(JSON.parse(text));
    } catch {
      return null;
    }
  }

  return extractErrorMessage(value);
}

function extractStatusCode(value: unknown): number | null {
  if (!value || typeof value !== "object") return null;
  const code = (value as { statusCode?: unknown }).statusCode;
  return typeof code === "number" ? code : null;
}

function enrichProviderErrorMessage(message: string, error: unknown): string {
  const normalized = normalizeProviderErrorMessage(message);
  if (!isGenericProviderErrorMessage(normalized)) {
    return normalized;
  }

  if (error && typeof error === "object") {
    const { responseBody, data } = error as {
      responseBody?: unknown;
      data?: unknown;
    };
    const extracted = extractErrorMessageFromBody(responseBody) ?? extractErrorMessageFromBody(data);
    if (extracted) {
      return normalizeProviderErrorMessage(extracted);
    }
  }

  const statusCode = extractStatusCode(error);
  if (statusCode !== null) {
    return `Provider returned error (HTTP ${statusCode}).`;
  }

  return normalized;
}

export function toReadableError(e: unknown): string {
  if (e instanceof Error) return enrichProviderErrorMessage(e.message, e);
  if (e && typeof e === "object") {
    if ("message" in e && typeof e.message === "string") {
      return enrichProviderErrorMessage(e.message, e);
    }
    if ("name" in e && typeof e.name === "string") return e.name;
  }
  if (typeof e === "string") return normalizeProviderErrorMessage(e);
  return "Unknown error";
}
