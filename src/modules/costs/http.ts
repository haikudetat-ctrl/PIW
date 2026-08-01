export async function fetchWithTimeout(
  url: string,
  init: RequestInit = {},
  timeoutMs = 15_000,
) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

export async function requireOk(response: Response, provider: string) {
  if (response.ok) return response;
  const detail = (await response.text()).slice(0, 500);
  throw new Error(`${provider} returned HTTP ${response.status}${detail ? `: ${detail}` : ""}`);
}
