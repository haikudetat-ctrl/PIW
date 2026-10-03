import "server-only";

// Server-side Cloudflare Turnstile verification. Anything other than a clean
// pass for an expected hostname and action is a failure; a Cloudflare outage is
// "unavailable", which callers must treat like a failed challenge (the browser
// retries with the interactive widget), never as a pass.

const SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
const MAX_TOKEN_LENGTH = 2048;
const TIMEOUT_MS = 3_000;

export type TurnstileResult = {kind: "passed"} | {kind: "failed"} | {kind: "unavailable"};

export async function verifyTurnstile(input: {
  token: string;
  remoteIp: string | null;
  secretKey: string;
  expectedHostnames: readonly string[];
  expectedAction: string;
  fetch?: typeof fetch;
}): Promise<TurnstileResult> {
  if (!input.token || input.token.length > MAX_TOKEN_LENGTH) return {kind: "failed"};

  const body = new URLSearchParams({secret: input.secretKey, response: input.token});
  if (input.remoteIp) body.set("remoteip", input.remoteIp);

  let response: Response;
  try {
    response = await (input.fetch ?? fetch)(SITEVERIFY_URL, {
      method: "POST",
      body,
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
  } catch {
    return {kind: "unavailable"};
  }
  if (!response.ok) return {kind: "unavailable"};

  const result = await response.json().catch(() => null) as {
    success?: unknown;
    hostname?: unknown;
    action?: unknown;
  } | null;
  if (!result) return {kind: "unavailable"};

  const passed = result.success === true
    && typeof result.hostname === "string"
    && input.expectedHostnames.includes(result.hostname.toLowerCase())
    && result.action === input.expectedAction;
  return passed ? {kind: "passed"} : {kind: "failed"};
}
