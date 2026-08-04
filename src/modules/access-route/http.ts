import type { JsonRecord } from "./contracts";

export class VendorReadError extends Error {
  constructor(
    public readonly vendor: string,
    public readonly category: "authentication" | "authorization" | "rate_limit" | "upstream" | "invalid_response",
    message: string,
  ) {
    super(message);
    this.name = "VendorReadError";
  }
}

function categoryForStatus(status: number): VendorReadError["category"] {
  if (status === 401) return "authentication";
  if (status === 403) return "authorization";
  if (status === 429) return "rate_limit";
  return "upstream";
}

export async function getJson(input: {
  vendor: string;
  url: URL;
  headers?: HeadersInit;
  fetcher?: typeof fetch;
  attempts?: number;
}): Promise<unknown> {
  const fetcher = input.fetcher ?? fetch;
  const attempts = input.attempts ?? 3;
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetcher(input.url, {
        method: "GET",
        headers: { Accept: "application/json", ...input.headers },
        cache: "no-store",
      });
      if (!response.ok) {
        const category = categoryForStatus(response.status);
        const error = new VendorReadError(
          input.vendor,
          category,
          `${input.vendor} read failed with HTTP ${response.status}`,
        );
        if (![429, 500, 502, 503, 504].includes(response.status) || attempt === attempts) throw error;
        lastError = error;
      } else {
        try {
          return await response.json();
        } catch {
          throw new VendorReadError(input.vendor, "invalid_response", `${input.vendor} returned invalid JSON`);
        }
      }
    } catch (error) {
      if (error instanceof VendorReadError && ["authentication", "authorization", "invalid_response"].includes(error.category)) {
        throw error;
      }
      lastError = error instanceof Error ? error : new Error(`${input.vendor} read failed`);
      if (attempt === attempts) break;
    }
    await new Promise((resolve) => setTimeout(resolve, 100 * (2 ** (attempt - 1))));
  }

  if (lastError instanceof VendorReadError) throw lastError;
  throw new VendorReadError(input.vendor, "upstream", `${input.vendor} read failed after retries`);
}

export function basicAuth(username: string, password: string): string {
  return `Basic ${Buffer.from(`${username}:${password}`, "utf8").toString("base64")}`;
}

export function safeMetadata(values: JsonRecord): JsonRecord {
  return Object.fromEntries(Object.entries(values).filter(([, value]) => value !== undefined));
}
