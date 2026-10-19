import {describe, expect, test, vi} from "vitest";

vi.mock("@/inngest/client", () => ({inngest: {send: vi.fn()}}));

const {selectGoogleCredentials} = await import("./booking-runtime");

const provider = "projects/123456789012/locations/global/workloadIdentityPools/vercel/providers/vercel";

describe("selectGoogleCredentials", () => {
  test("prefers keyless workload identity when it is configured", () => {
    expect(selectGoogleCredentials({
      GOOGLE_CALENDAR_DELEGATED_USER: "scheduling@allseason.example",
      GOOGLE_CALENDAR_SERVICE_ACCOUNT_EMAIL: "booking@project.iam.gserviceaccount.com",
      GOOGLE_WORKLOAD_IDENTITY_PROVIDER: provider,
      GOOGLE_CALENDAR_SERVICE_ACCOUNT_JSON: "{}",
    })).toEqual({
      mode: "workload_identity",
      serviceAccountEmail: "booking@project.iam.gserviceaccount.com",
      provider,
      delegatedUser: "scheduling@allseason.example",
    });
  });

  test("falls back to a key file", () => {
    expect(selectGoogleCredentials({
      GOOGLE_CALENDAR_DELEGATED_USER: "scheduling@allseason.example",
      GOOGLE_CALENDAR_SERVICE_ACCOUNT_JSON: "{}",
    })).toMatchObject({mode: "key_file"});
  });

  test("is off without a delegated user or any credential", () => {
    expect(selectGoogleCredentials({GOOGLE_CALENDAR_SERVICE_ACCOUNT_JSON: "{}"})).toBeNull();
    expect(selectGoogleCredentials({GOOGLE_CALENDAR_DELEGATED_USER: "scheduling@allseason.example"})).toBeNull();
  });
});
