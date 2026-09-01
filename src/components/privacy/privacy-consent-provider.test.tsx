import {act, fireEvent, render, screen, waitFor} from "@testing-library/react";
import {afterEach, describe, expect, test, vi} from "vitest";
import type {VerifiedConsent} from "@/modules/privacy/consent";
import {
  PrivacyConsentProvider,
  usePrivacyConsent,
} from "./privacy-consent-provider";

const rejectedConsent: VerifiedConsent = {
  policyVersion: "piw-privacy-v1",
  consentId: "11111111-1111-4111-8111-111111111111",
  preferences: {necessary: true, analytics: false, advertising: false},
  gpcDetected: false,
  updatedAt: "2026-08-28T12:00:00.000Z",
};

const advertisingConsent: VerifiedConsent = {
  ...rejectedConsent,
  preferences: {necessary: true, analytics: true, advertising: true},
};

function Probe() {
  const {preferences, status} = usePrivacyConsent();
  return (
    <>
      <output data-testid="preferences">{JSON.stringify(preferences)}</output>
      <output data-testid="status">{status}</output>
    </>
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  Object.defineProperty(navigator, "globalPrivacyControl", {
    value: undefined,
    configurable: true,
  });
});

describe("PrivacyConsentProvider", () => {
  test("offers equally accessible accept, reject, and customize actions", () => {
    render(<PrivacyConsentProvider initialConsent={null}><div /></PrivacyConsentProvider>);

    expect(screen.getByRole("button", {name: "Accept all"})).toBeVisible();
    expect(screen.getByRole("button", {name: "Reject nonessential"})).toBeVisible();
    expect(screen.getByRole("button", {name: "Customize"})).toBeVisible();
  });

  test("reject keeps necessary on and nonessential off", async () => {
    const fetchMock = vi.fn(async () => Response.json({consent: rejectedConsent}));
    vi.stubGlobal("fetch", fetchMock);
    render(<PrivacyConsentProvider initialConsent={null}><Probe /></PrivacyConsentProvider>);

    fireEvent.click(screen.getByRole("button", {name: "Reject nonessential"}));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      "/api/privacy/consent",
      expect.objectContaining({method: "POST"}),
    ));
    expect(await screen.findByTestId("preferences")).toHaveTextContent(
      '{"necessary":true,"analytics":false,"advertising":false}',
    );
    expect(screen.getByTestId("status")).toHaveTextContent("saved");
  });

  test("GPC starts with advertising disabled", () => {
    Object.defineProperty(navigator, "globalPrivacyControl", {
      value: true,
      configurable: true,
    });
    render(<PrivacyConsentProvider initialConsent={null}><div /></PrivacyConsentProvider>);

    fireEvent.click(screen.getByRole("button", {name: "Customize"}));

    expect(screen.getByRole("checkbox", {name: "Advertising"})).not.toBeChecked();
    expect(screen.getByText(/Global Privacy Control/i)).toBeVisible();
  });

  test("newly detected GPC immediately suppresses existing Advertising consent", () => {
    Object.defineProperty(navigator, "globalPrivacyControl", {
      value: true,
      configurable: true,
    });
    render(<PrivacyConsentProvider initialConsent={advertisingConsent}><Probe /></PrivacyConsentProvider>);

    expect(screen.getByTestId("preferences")).toHaveTextContent(
      '{"necessary":true,"analytics":true,"advertising":false}',
    );
    expect(screen.getByText(/Global Privacy Control.*Advertising.*off/i)).toBeVisible();
  });

  test("permits an explicit Advertising grant after showing the GPC default", async () => {
    Object.defineProperty(navigator, "globalPrivacyControl", {
      value: true,
      configurable: true,
    });
    vi.stubGlobal("fetch", vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const request = JSON.parse(String(init?.body)) as {
        analytics: boolean;
        advertising: boolean;
        gpcDetected: boolean;
      };
      const advertising = request.advertising && !request.gpcDetected;
      return Response.json({consent: {
        policyVersion: "piw-privacy-v1",
        consentId: "11111111-1111-4111-8111-111111111111",
        preferences: {necessary: true, analytics: request.analytics, advertising},
        gpcDetected: request.gpcDetected,
        updatedAt: "2026-08-28T12:00:00.000Z",
      }});
    }));
    render(<PrivacyConsentProvider initialConsent={advertisingConsent}><Probe /></PrivacyConsentProvider>);
    expect(screen.getByText(/Global Privacy Control.*Advertising.*off/i)).toBeVisible();
    fireEvent.click(screen.getByRole("button", {name: "Privacy choices"}));

    const advertising = screen.getByRole("checkbox", {name: "Advertising"});
    expect(advertising).not.toBeChecked();
    expect(advertising).toBeEnabled();
    fireEvent.click(advertising);
    fireEvent.click(screen.getByRole("button", {name: "Save preferences"}));

    await waitFor(() => expect(screen.getByTestId("preferences")).toHaveTextContent(
      '{"necessary":true,"analytics":true,"advertising":true}',
    ));
    expect(screen.queryByText(/Global Privacy Control.*Advertising.*off/i))
      .not.toBeInTheDocument();
  });

  test("saved visitors can reopen privacy choices", () => {
    render(<PrivacyConsentProvider initialConsent={rejectedConsent}><div /></PrivacyConsentProvider>);

    fireEvent.click(screen.getByRole("button", {name: "Privacy choices"}));

    expect(screen.getByRole("dialog", {name: "Privacy choices"})).toBeVisible();
  });

  test("links to the versioned privacy notice", () => {
    render(<PrivacyConsentProvider initialConsent={null}><div /></PrivacyConsentProvider>);

    expect(screen.getByRole("link", {name: "Privacy policy"}))
      .toHaveAttribute("href", "/privacy");
  });

  test("keeps the choices available and announces a failed save", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, {status: 503})));
    render(<PrivacyConsentProvider initialConsent={null}><Probe /></PrivacyConsentProvider>);

    fireEvent.click(screen.getByRole("button", {name: "Accept all"}));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "We could not save your privacy choices. Please try again.",
    );
    expect(screen.getByRole("button", {name: "Accept all"})).toBeVisible();
    expect(screen.getByTestId("status")).toHaveTextContent("unset");
  });

  test("fails closed when the consent endpoint returns an incomplete snapshot", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({
      consent: {preferences: {necessary: true, analytics: true, advertising: true}},
    })));
    render(<PrivacyConsentProvider initialConsent={null}><Probe /></PrivacyConsentProvider>);

    fireEvent.click(screen.getByRole("button", {name: "Accept all"}));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "We could not save your privacy choices. Please try again.",
    );
    expect(screen.getByTestId("status")).toHaveTextContent("unset");
    expect(screen.getByTestId("preferences")).toHaveTextContent(
      '{"necessary":true,"analytics":false,"advertising":false}',
    );
  });

  test.each([
    ["policyVersion", {
      consentId: "11111111-1111-4111-8111-111111111111",
      preferences: {necessary: true, analytics: true, advertising: true},
      gpcDetected: false,
      updatedAt: "2026-08-28T12:00:00.000Z",
    }],
    ["consentId", {
      policyVersion: "piw-privacy-v1",
      preferences: {necessary: true, analytics: true, advertising: true},
      gpcDetected: false,
      updatedAt: "2026-08-28T12:00:00.000Z",
    }],
    ["updatedAt", {
      policyVersion: "piw-privacy-v1",
      consentId: "11111111-1111-4111-8111-111111111111",
      preferences: {necessary: true, analytics: true, advertising: true},
      gpcDetected: false,
    }],
  ])("rejects a saved response missing %s", async (_field, consent) => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({consent})));
    render(<PrivacyConsentProvider initialConsent={null}><Probe /></PrivacyConsentProvider>);

    fireEvent.click(screen.getByRole("button", {name: "Accept all"}));

    expect(await screen.findByRole("alert")).toBeVisible();
    expect(screen.getByTestId("status")).toHaveTextContent("unset");
  });

  test.each([
    ["policy version", {...advertisingConsent, policyVersion: "piw-privacy-v0"}],
    ["consent ID", {...advertisingConsent, consentId: "not-a-uuid"}],
    ["updated time", {...advertisingConsent, updatedAt: "yesterday"}],
  ])("rejects a saved response with an invalid %s", async (_field, consent) => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({consent})));
    render(<PrivacyConsentProvider initialConsent={null}><Probe /></PrivacyConsentProvider>);

    fireEvent.click(screen.getByRole("button", {name: "Accept all"}));

    expect(await screen.findByRole("alert")).toBeVisible();
    expect(screen.getByTestId("status")).toHaveTextContent("unset");
  });

  test("keeps an in-flight preferences dialog available until a failed save is announced", async () => {
    let finishRequest: ((response: Response) => void) | undefined;
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>((resolve) => {
      finishRequest = resolve;
    })));
    render(<PrivacyConsentProvider initialConsent={rejectedConsent}><div /></PrivacyConsentProvider>);
    fireEvent.click(screen.getByRole("button", {name: "Privacy choices"}));
    fireEvent.click(screen.getByRole("button", {name: "Save preferences"}));

    const dialog = screen.getByRole("dialog", {name: "Privacy choices"});
    fireEvent.keyDown(dialog, {key: "Escape"});
    expect(dialog).toBeVisible();

    await act(async () => finishRequest?.(new Response(null, {status: 503})));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "We could not save your privacy choices. Please try again.",
    );
    expect(screen.getByRole("dialog", {name: "Privacy choices"})).toBeVisible();
  });

  test("dialog traps focus, closes with Escape, and restores the opener", () => {
    render(<PrivacyConsentProvider initialConsent={rejectedConsent}><div /></PrivacyConsentProvider>);
    const opener = screen.getByRole("button", {name: "Privacy choices"});
    opener.focus();
    fireEvent.click(opener);

    const dialog = screen.getByRole("dialog", {name: "Privacy choices"});
    const cancel = screen.getByRole("button", {name: "Cancel"});
    cancel.focus();
    fireEvent.keyDown(dialog, {key: "Tab"});
    expect(screen.getByRole("checkbox", {name: "Analytics"})).toHaveFocus();

    fireEvent.keyDown(dialog, {key: "Escape"});
    expect(screen.queryByRole("dialog", {name: "Privacy choices"})).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
  });

  test("necessary consent is always checked and cannot be disabled", () => {
    render(<PrivacyConsentProvider initialConsent={null}><div /></PrivacyConsentProvider>);
    fireEvent.click(screen.getByRole("button", {name: "Customize"}));

    expect(screen.getByRole("checkbox", {name: "Necessary"})).toBeChecked();
    expect(screen.getByRole("checkbox", {name: "Necessary"})).toBeDisabled();
  });

  test("keeps the consent controls in flow before mobile lead actions", () => {
    const submit = vi.fn((event: React.FormEvent) => event.preventDefault());
    render(
      <PrivacyConsentProvider initialConsent={null}>
        <form aria-label="Lead form" onSubmit={submit}>
          <button type="submit">Submit lead</button>
        </form>
      </PrivacyConsentProvider>,
    );

    const banner = screen.getByRole("region", {name: "Privacy choices"});
    const form = screen.getByRole("form", {name: "Lead form"});
    expect(banner.compareDocumentPosition(form) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    fireEvent.click(screen.getByRole("button", {name: "Submit lead"}));
    expect(submit).toHaveBeenCalledOnce();
  });
});
