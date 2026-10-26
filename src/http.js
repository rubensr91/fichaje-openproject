export function trimBase(url) {
  return String(url || "").trim().replace(/\/+$/, "");
}

export function withQuery(url, params = {}) {
  const target = new URL(url);
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") {
      continue;
    }
    target.searchParams.set(key, Array.isArray(value) ? value.join(",") : String(value));
  }
  return target.toString();
}

function extractError(payload, fallback) {
  if (typeof payload === "string" && payload.trim()) {
    return payload.trim().slice(0, 600);
  }
  if (payload && typeof payload === "object") {
    const message = payload.message || payload.error?.message || payload.error;
    if (typeof message === "string" && message.trim()) {
      return message.trim().slice(0, 600);
    }
    if (message && typeof message === "object") {
      return JSON.stringify(message).slice(0, 600);
    }
  }
  return fallback;
}

export async function requestJson(url, options = {}) {
  const controller = new AbortController();
  const timeoutMs = options.timeoutMs || 30000;
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal
    });
    const text = await response.text();
    let payload = null;
    if (text) {
      try {
        payload = JSON.parse(text);
      } catch {
        payload = text;
      }
    }

    if (!response.ok) {
      const message = extractError(payload, `${response.status} ${response.statusText}`);
      throw new Error(`${response.status}: ${message}`);
    }

    return payload;
  } catch (error) {
    if (error.name === "AbortError") {
      throw new Error("La petición tardó demasiado. Revisa la conexión.");
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}