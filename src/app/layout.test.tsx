import {render, screen} from "@testing-library/react";
import {afterEach, beforeEach, describe, expect, test, vi} from "vitest";
import {signConsentCookie} from "@/modules/privacy/consent";
import {usePrivacyConsent} from "@/components/privacy/privacy-consent-provider";

const mocks = vi.hoisted(() => ({
  cookies: vi.fn(),
}));

vi.mock("next/headers", () => ({cookies: mocks.cookies}));
vi.mock("next/font/google", () => ({
  Bebas_Neue: () => ({variable: "font-bebas"}),
  Geist: () => ({variable: "font-geist"}),
  Geist_Mono: () => ({variable: "font-geist-mono"}),
  Montserrat: () => ({variable: "font-montserrat"}),
}));

const {default: RootLayout} = await import("./layout");
const signingSecret = "0123456789abcdef0123456789abcdef";
const originalSigningSecret = process.env.PRIVACY_CONSENT_SIGNING_SECRET;

function Probe() {
  const {preferences, status} = usePrivacyConsent();
  return <output data-testid="layout-consent">{status}:{JSON.stringify(preferences)}</output>;
}

beforeEach(() => {
  process.env.PRIVACY_CONSENT_SIGNING_SECRET = signingSecret;
  mocks.cookies.mockReset();
});

afterEach(() => {
  if (originalSigningSecret === undefined) {
    delete process.env.PRIVACY_CONSENT_SIGNING_SECRET;
  } else {
    process.env.PRIVACY_CONSENT_SIGNING_SECRET = originalSigningSecret;
  }
});

describe("RootLayout privacy consent", () => {
  test("supplies the verified signed-cookie state to the consent provider", async () => {
    const signedCookie = signConsentCookie({
      consentId: "11111111-1111-4111-8111-111111111111",
      preferences: {necessary: true, analytics: true, advertising: false},
      gpcDetected: false,
      updatedAt: "2026-08-28T12:00:00.000Z",
    }, signingSecret);
    mocks.cookies.mockResolvedValue({
      get: (name: string) => name === "piw_privacy" ? {value: signedCookie} : undefined,
    });

    render(await RootLayout({children: <Probe />}));

    expect(screen.getByTestId("layout-consent")).toHaveTextContent(
      'saved:{"necessary":true,"analytics":true,"advertising":false}',
    );
    expect(screen.queryByRole("button", {name: "Accept all"})).not.toBeInTheDocument();
  });

  test("fails closed when the cookie signature is invalid", async () => {
    mocks.cookies.mockResolvedValue({
      get: () => ({value: "not-a-valid-signed-cookie"}),
    });

    render(await RootLayout({children: <Probe />}));

    expect(screen.getByTestId("layout-consent")).toHaveTextContent(
      'unset:{"necessary":true,"analytics":false,"advertising":false}',
    );
    expect(screen.getByRole("button", {name: "Reject nonessential"})).toBeVisible();
  });

  test("fails closed without a signing secret", async () => {
    delete process.env.PRIVACY_CONSENT_SIGNING_SECRET;
    mocks.cookies.mockResolvedValue({get: () => ({value: "unverified"})});

    render(await RootLayout({children: <Probe />}));

    expect(screen.getByTestId("layout-consent")).toHaveTextContent(
      'unset:{"necessary":true,"analytics":false,"advertising":false}',
    );
  });
});
