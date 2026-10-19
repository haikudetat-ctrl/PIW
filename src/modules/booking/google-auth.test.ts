import {createVerify, generateKeyPairSync} from "node:crypto";
import {describe, expect, test, vi} from "vitest";
import {
  CALENDAR_SCOPE,
  GoogleAccessTokenProvider,
  KeyFileSigner,
  parseServiceAccountJson,
  WorkloadIdentitySigner,
  workloadIdentityProviderSchema,
  type AssertionSigner,
  type DelegationClaims,
} from "./google-auth";

const {privateKey, publicKey} = generateKeyPairSync("rsa", {modulusLength: 2048});
const account = {
  clientEmail: "booking@piw-test.iam.gserviceaccount.com",
  privateKey: privateKey.export({type: "pkcs8", format: "pem"}).toString(),
};
const provider = "projects/123456789012/locations/global/workloadIdentityPools/vercel/providers/vercel";
const claims: DelegationClaims = {
  iss: account.clientEmail,
  sub: "scheduler@allseason.example",
  scope: CALENDAR_SCOPE,
  aud: "https://oauth2.googleapis.com/token",
  iat: 1_800_000_000,
  exp: 1_800_003_600,
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {status, headers: {"content-type": "application/json"}});
}

describe("KeyFileSigner", () => {
  test("parses a service account key file", () => {
    const parsed = parseServiceAccountJson(JSON.stringify({
      type: "service_account",
      client_email: account.clientEmail,
      private_key: account.privateKey,
    }));
    expect(parsed.clientEmail).toBe(account.clientEmail);
    expect(() => parseServiceAccountJson("{")).toThrow("not valid JSON");
    expect(() => parseServiceAccountJson(JSON.stringify({type: "authorized_user"}))).toThrow("missing fields");
  });

  test("signs an RS256 assertion locally", async () => {
    const assertion = await new KeyFileSigner(account).sign(claims);
    const [header, body, signature] = assertion.split(".");
    expect(createVerify("RSA-SHA256").update(`${header}.${body}`).verify(publicKey, signature, "base64url")).toBe(true);
    expect(JSON.parse(Buffer.from(body, "base64url").toString())).toEqual(claims);
  });
});

describe("WorkloadIdentitySigner", () => {
  test("trades the Vercel token for a federated token, then has Google sign the claims", async () => {
    const calls: Array<{url: string; init?: RequestInit}> = [];
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({url, init});
      return url.startsWith("https://sts.googleapis.com")
        ? json({access_token: "federated-1", expires_in: 3600, token_type: "Bearer"})
        : json({keyId: "k1", signedJwt: "header.payload.signature"});
    });
    const signer = new WorkloadIdentitySigner({
      serviceAccountEmail: account.clientEmail,
      provider,
      subjectToken: () => "vercel-oidc-token",
      fetchImpl: fetchMock,
    });

    expect(await signer.sign(claims)).toBe("header.payload.signature");

    const exchange = new URLSearchParams(String(calls[0].init?.body));
    expect(calls[0].url).toBe("https://sts.googleapis.com/v1/token");
    expect(Object.fromEntries(exchange)).toEqual({
      grant_type: "urn:ietf:params:oauth:grant-type:token-exchange",
      audience: `//iam.googleapis.com/${provider}`,
      scope: "https://www.googleapis.com/auth/cloud-platform",
      requested_token_type: "urn:ietf:params:oauth:token-type:access_token",
      subject_token: "vercel-oidc-token",
      subject_token_type: "urn:ietf:params:oauth:token-type:jwt",
    });
    expect(calls[1].url).toBe(
      "https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/booking%40piw-test.iam.gserviceaccount.com:signJwt",
    );
    expect((calls[1].init?.headers as Record<string, string>).authorization).toBe("Bearer federated-1");
    expect(JSON.parse(JSON.parse(String(calls[1].init?.body)).payload)).toEqual(claims);
  });

  test("reuses the federated token until it is about to expire", async () => {
    let now = 1_800_000_000_000;
    const subjectToken = vi.fn(() => "vercel-oidc-token");
    const fetchMock = vi.fn(async (url: string) =>
      url.startsWith("https://sts.googleapis.com")
        ? json({access_token: "federated", expires_in: 3600})
        : json({signedJwt: "signed"}));
    const signer = new WorkloadIdentitySigner({serviceAccountEmail: account.clientEmail, provider, subjectToken, fetchImpl: fetchMock, now: () => now});
    await signer.sign(claims);
    now += 30 * 60_000;
    await signer.sign(claims);
    expect(subjectToken).toHaveBeenCalledTimes(1);
    now += 30 * 60_000;
    await signer.sign(claims);
    expect(subjectToken).toHaveBeenCalledTimes(2);
  });

  test("reports a missing Token Creator grant as a 403", async () => {
    const signer = new WorkloadIdentitySigner({
      serviceAccountEmail: account.clientEmail,
      provider,
      subjectToken: () => "vercel-oidc-token",
      fetchImpl: async (url) => url.startsWith("https://sts") ? json({access_token: "f", expires_in: 3600}) : json({error: {code: 403}}, 403),
    });
    await expect(signer.sign(claims)).rejects.toMatchObject({status: 403, message: "Google signJwt failed with 403"});
  });

  test("reports a rejected Vercel token from the exchange", async () => {
    const signer = new WorkloadIdentitySigner({
      serviceAccountEmail: account.clientEmail,
      provider,
      subjectToken: () => "wrong-audience",
      fetchImpl: async () => json({error: "invalid_grant"}, 400),
    });
    await expect(signer.sign(claims)).rejects.toMatchObject({status: 400});
  });

  test("accepts only a full provider resource name", () => {
    expect(workloadIdentityProviderSchema.safeParse(provider).success).toBe(true);
    expect(workloadIdentityProviderSchema.safeParse("vercel").success).toBe(false);
    expect(workloadIdentityProviderSchema.safeParse(`//iam.googleapis.com/${provider}`).success).toBe(false);
  });
});

describe("GoogleAccessTokenProvider", () => {
  const signer: AssertionSigner = {serviceAccountEmail: account.clientEmail, sign: vi.fn(async () => "signed-assertion")};

  test("asks the signer for a delegation JWT for the calendar scope and exchanges it", async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      expect(Object.fromEntries(new URLSearchParams(String(init?.body)))).toEqual({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion: "signed-assertion",
      });
      return json({access_token: "calendar-token", expires_in: 3600});
    });
    const tokens = new GoogleAccessTokenProvider(signer, "scheduler@allseason.example", fetchMock, () => 1_800_000_000_000);
    expect(await tokens.getToken()).toBe("calendar-token");
    expect(signer.sign).toHaveBeenCalledWith(claims);
  });

  test("caches until a minute before expiry and shares one refresh across callers", async () => {
    let now = 1_800_000_000_000;
    const fetchMock = vi.fn(async () => json({access_token: `token-${fetchMock.mock.calls.length}`, expires_in: 3600}));
    const tokens = new GoogleAccessTokenProvider(signer, "scheduler@allseason.example", fetchMock, () => now);
    expect(await Promise.all([tokens.getToken(), tokens.getToken()])).toEqual(["token-1", "token-1"]);
    now += 58 * 60_000;
    expect(await tokens.getToken()).toBe("token-1");
    now += 2 * 60_000;
    expect(await tokens.getToken()).toBe("token-2");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  test("surfaces missing domain-wide delegation as a 401", async () => {
    const tokens = new GoogleAccessTokenProvider(signer, "scheduler@allseason.example", async () => json({error: "unauthorized_client"}, 401));
    await expect(tokens.getToken()).rejects.toMatchObject({status: 401});
  });
});
