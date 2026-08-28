export const DEFAULT_AERIAL_RETRY_MS = 2_500;

export type AssessmentAerialResult =
  | {kind: "ready"; objectUrl: string}
  | {kind: "retry"; delayMs: number}
  | {kind: "unavailable"};

type FetchLike = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

function retryDelay(response: Response, now: () => number) {
  const value = response.headers.get("retry-after")?.trim();
  if (!value) return DEFAULT_AERIAL_RETRY_MS;
  if (/^\d+$/.test(value)) return Number(value) * 1_000;

  const retryAt = Date.parse(value);
  if (!Number.isFinite(retryAt)) return DEFAULT_AERIAL_RETRY_MS;
  return Math.max(0, retryAt - now());
}

function isRetryable(status: number) {
  return status === 404 || status === 408 || status === 425 || status === 429 || status >= 500;
}

export async function loadAssessmentAerial({
  imageSrc,
  signal,
  fetchFn = fetch,
  createObjectURL = URL.createObjectURL.bind(URL),
  now = Date.now,
}: {
  imageSrc: string;
  signal: AbortSignal;
  fetchFn?: FetchLike;
  createObjectURL?: (blob: Blob) => string;
  now?: () => number;
}): Promise<AssessmentAerialResult> {
  let response: Response;
  try {
    response = await fetchFn(imageSrc, {signal});
  } catch (error) {
    if (signal.aborted || (error instanceof DOMException && error.name === "AbortError")) {
      throw error;
    }
    return {kind: "retry", delayMs: DEFAULT_AERIAL_RETRY_MS};
  }

  if (response.ok) {
    const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
    if (!contentType.startsWith("image/")) return {kind: "unavailable"};
    return {kind: "ready", objectUrl: createObjectURL(await response.blob())};
  }

  if (isRetryable(response.status)) {
    return {kind: "retry", delayMs: retryDelay(response, now)};
  }

  return {kind: "unavailable"};
}
