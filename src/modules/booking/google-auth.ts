import "server-only";
import {createSign} from "node:crypto";
import {z} from "zod";

// Domain-wide delegation needs a JWT signed as the service account, with
// `sub` set to the Workspace user PIW acts as. Two ways to get that
// signature:
//
//   KeyFileSigner          signs locally with a downloaded JSON key.
//   WorkloadIdentitySigner asks Google to sign (IAM Credentials signJwt),
//                          authenticated by Vercel's per-request OIDC token
//                          through Workload Identity Federation. No key exists.
//
// Either way the signed JWT is exchanged for a calendar access token the
// same way, so the rest of the calendar client does not care which is used.

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const STS_URL = "https://sts.googleapis.com/v1/token";
const IAM_CREDENTIALS_URL = "https://iamcredentials.googleapis.com/v1";
const CLOUD_PLATFORM_SCOPE = "https://www.googleapis.com/auth/cloud-platform";
export const CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar.events";
const REQUEST_TIMEOUT_MS = 10_000;
const REFRESH_MARGIN_MS = 60_000;

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export class GoogleAuthError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

export type DelegationClaims = {
  iss: string;
  sub: string;
  scope: string;
  aud: string;
  iat: number;
  exp: number;
};

export interface AssertionSigner {
  readonly serviceAccountEmail: string;
  sign(claims: DelegationClaims): Promise<string>;
}

// ---------------------------------------------------------------------------
// Key file
// ---------------------------------------------------------------------------

const serviceAccountSchema = z.object({
  type: z.literal("service_account"),
  client_email: z.email(),
  private_key: z.string().includes("PRIVATE KEY"),
});

export type GoogleServiceAccount = {clientEmail: string; privateKey: string};

export function parseServiceAccountJson(json: string): GoogleServiceAccount {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    throw new Error("Google Calendar service account JSON is not valid JSON");
  }
  const parsed = serviceAccountSchema.safeParse(raw);
  if (!parsed.success) throw new Error("Google Calendar service account JSON is missing fields");
  return {clientEmail: parsed.data.client_email, privateKey: parsed.data.private_key};
}

function base64UrlJson(value: unknown) {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

export class KeyFileSigner implements AssertionSigner {
  constructor(private readonly account: GoogleServiceAccount) {}

  get serviceAccountEmail() {
    return this.account.clientEmail;
  }

  async sign(claims: DelegationClaims) {
    const unsigned = `${base64UrlJson({alg: "RS256", typ: "JWT"})}.${base64UrlJson(claims)}`;
    const signature = createSign("RSA-SHA256").update(unsigned).sign(this.account.privateKey, "base64url");
    return `${unsigned}.${signature}`;
  }
}

// ---------------------------------------------------------------------------
// Workload Identity Federation (keyless)
// ---------------------------------------------------------------------------

/** projects/<number>/locations/global/workloadIdentityPools/<pool>/providers/<provider> */
export const workloadIdentityProviderSchema = z
  .string()
  .regex(/^projects\/\d+\/locations\/global\/workloadIdentityPools\/[a-z0-9-]{4,32}\/providers\/[a-z0-9-]{4,32}$/);

const stsResponseSchema = z.object({
  access_token: z.string().min(1),
  expires_in: z.number().int().positive(),
});

const signJwtResponseSchema = z.object({signedJwt: z.string().min(1)});

export class WorkloadIdentitySigner implements AssertionSigner {
  private federated: {token: string; expiresAt: number} | null = null;

  constructor(
    private readonly options: {
      serviceAccountEmail: string;
      /** Full provider resource name; see workloadIdentityProviderSchema. */
      provider: string;
      /** Vercel's OIDC token for the current request. Read fresh on every exchange. */
      subjectToken: () => string | Promise<string>;
      fetchImpl?: FetchLike;
      now?: () => number;
    },
  ) {}

  get serviceAccountEmail() {
    return this.options.serviceAccountEmail;
  }

  private get fetchImpl() {
    return this.options.fetchImpl ?? fetch;
  }

  private now() {
    return this.options.now?.() ?? Date.now();
  }

  /** Trades the Vercel OIDC token for a short-lived Google federated token. */
  private async federatedToken() {
    if (this.federated && this.federated.expiresAt - REFRESH_MARGIN_MS > this.now()) return this.federated.token;
    const subjectToken = await this.options.subjectToken();
    // RFC 8693 token exchange, form-encoded as Google's own client library sends it.
    const response = await this.fetchImpl(STS_URL, {
      method: "POST",
      headers: {"content-type": "application/x-www-form-urlencoded"},
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:token-exchange",
        audience: `//iam.googleapis.com/${this.options.provider}`,
        scope: CLOUD_PLATFORM_SCOPE,
        requested_token_type: "urn:ietf:params:oauth:token-type:access_token",
        subject_token: subjectToken,
        subject_token_type: "urn:ietf:params:oauth:token-type:jwt",
      }).toString(),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) {
      throw new GoogleAuthError(`Google workload identity exchange failed with ${response.status}`, response.status);
    }
    const parsed = stsResponseSchema.safeParse(await response.json());
    if (!parsed.success) throw new GoogleAuthError("Google workload identity response was malformed", 502);
    this.federated = {token: parsed.data.access_token, expiresAt: this.now() + parsed.data.expires_in * 1000};
    return parsed.data.access_token;
  }

  async sign(claims: DelegationClaims) {
    const token = await this.federatedToken();
    const response = await this.fetchImpl(
      `${IAM_CREDENTIALS_URL}/projects/-/serviceAccounts/${encodeURIComponent(this.options.serviceAccountEmail)}:signJwt`,
      {
        method: "POST",
        headers: {authorization: `Bearer ${token}`, "content-type": "application/json"},
        body: JSON.stringify({payload: JSON.stringify(claims)}),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      },
    );
    if (!response.ok) {
      // A 403 here almost always means the Vercel identity lacks Service
      // Account Token Creator on the service account.
      throw new GoogleAuthError(`Google signJwt failed with ${response.status}`, response.status);
    }
    const parsed = signJwtResponseSchema.safeParse(await response.json());
    if (!parsed.success) throw new GoogleAuthError("Google signJwt response was malformed", 502);
    return parsed.data.signedJwt;
  }
}

// ---------------------------------------------------------------------------
// Delegated access token
// ---------------------------------------------------------------------------

const tokenResponseSchema = z.object({
  access_token: z.string().min(1),
  expires_in: z.number().int().positive(),
});

export type AccessTokenSource = {getToken(): Promise<string>};

/** A calendar access token acting as `subject`, cached until a minute before expiry. */
export class GoogleAccessTokenProvider implements AccessTokenSource {
  private cached: {token: string; expiresAt: number} | null = null;
  private pending: Promise<string> | null = null;

  constructor(
    private readonly signer: AssertionSigner,
    private readonly subject: string,
    private readonly fetchImpl: FetchLike = fetch,
    private readonly now: () => number = Date.now,
  ) {}

  async getToken() {
    if (this.cached && this.cached.expiresAt - REFRESH_MARGIN_MS > this.now()) return this.cached.token;
    // Concurrent callers share one refresh instead of each signing a JWT.
    this.pending ??= this.refresh().finally(() => {
      this.pending = null;
    });
    return this.pending;
  }

  private async refresh() {
    const issuedAt = Math.floor(this.now() / 1000);
    const assertion = await this.signer.sign({
      iss: this.signer.serviceAccountEmail,
      sub: this.subject,
      scope: CALENDAR_SCOPE,
      aud: TOKEN_URL,
      iat: issuedAt,
      exp: issuedAt + 3600,
    });
    const response = await this.fetchImpl(TOKEN_URL, {
      method: "POST",
      headers: {"content-type": "application/x-www-form-urlencoded"},
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion,
      }).toString(),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) {
      // 401 unauthorized_client: delegation for this client ID or scope is missing in the Workspace admin console.
      throw new GoogleAuthError(`Google token exchange failed with ${response.status}`, response.status);
    }
    const parsed = tokenResponseSchema.safeParse(await response.json());
    if (!parsed.success) throw new GoogleAuthError("Google token response was malformed", 502);
    this.cached = {token: parsed.data.access_token, expiresAt: this.now() + parsed.data.expires_in * 1000};
    return parsed.data.access_token;
  }
}
