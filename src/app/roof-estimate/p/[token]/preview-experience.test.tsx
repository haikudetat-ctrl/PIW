import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { getRoofAssessmentContext } from "@/config/roof-assessment";
import type { PreviewView } from "@/modules/property-preview/preview-read-model";
import { PreviewExperience } from "./preview-experience";

const trackConversion = vi.fn();
vi.mock("@/components/marketing/meta-pixel-provider", () => ({
  useMetaPixel: () => ({trackConversion}),
}));

const token = "t".repeat(43);
const context = getRoofAssessmentContext("for-every-season");
const baseView: PreviewView = {
  status: "active",
  address: {display: "1 Main St, Newark, NJ 07102, USA", googleConfirmed: true},
  image: {state: "ready"},
  roof: {state: "ready", squares: 24, complexity: "moderate"},
  answered: [],
  savedEmail: false,
  campaign: null,
  presentationKey: "all-season-main",
  metaEventId: "88888888-8888-4888-8888-888888888888",
};
const readyAerial = vi.fn(async () => ({kind: "ready" as const, objectUrl: "blob:aerial"}));

function renderPreview(view: Partial<PreviewView> = {}, logoUrl?: string) {
  return render(
    <PreviewExperience
      token={token}
      initialView={{...baseView, ...view}}
      context={context}
      brandName="All Season Solar"
      logoUrl={logoUrl}
      privacyUrl="https://allseasonroofingquote.com/privacy.html"
      initialStage="reveal"
      aerialLoader={readyAerial}
    />,
  );
}

let fetchMock: ReturnType<typeof vi.fn>;
let assign: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn(async () => new Response(null, {status: 204}));
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal("scrollTo", vi.fn());
  assign = vi.fn();
  Object.defineProperty(window, "location", {value: {...window.location, assign}, configurable: true});
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function calls(path: string) {
  return fetchMock.mock.calls.filter(([url]) => String(url).includes(path));
}

describe("preview reveal", () => {
  test("sends Meta the RoofPreviewStarted event once, with the preview's stable event ID", async () => {
    trackConversion.mockClear();
    renderPreview();
    await screen.findByText("About 24 roofing squares");
    await waitFor(() => expect(trackConversion).toHaveBeenCalledTimes(1));
    expect(trackConversion.mock.calls[0][0]).toMatchObject({
      name: "RoofPreviewStarted",
      eventId: "88888888-8888-4888-8888-888888888888",
    });
  });

  test("shows the roof size and complexity without any price", async () => {
    renderPreview();
    expect(await screen.findByText("About 24 roofing squares")).toBeTruthy();
    expect(screen.getByText("Moderately complex roof")).toBeTruthy();
    expect(screen.getByText("1 Main St, Newark, NJ 07102, USA")).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/\$\d/);
    await waitFor(() => expect(calls("/progress")).toHaveLength(1));
    expect(JSON.parse(String(calls("/progress")[0][1].body))).toEqual({step: "revealed"});
  });

  test.each([
    [{state: "pending"} as const, "Measuring your roof…"],
    [{state: "review_required"} as const, "A roofing specialist will confirm your roof’s measurements."],
  ])("explains a %o measurement honestly", async (roof, copy) => {
    renderPreview({roof});
    expect(await screen.findByText(copy)).toBeTruthy();
    expect(screen.queryByText(/roofing squares/)).toBeNull();
  });

  test("never labels a manual address as confirmed", async () => {
    renderPreview({address: {display: "2 Main St, Newark, NJ", googleConfirmed: false}, image: {state: "unavailable"}, roof: {state: "review_required"}});
    expect(await screen.findByText("2 Main St, Newark, NJ")).toBeTruthy();
    expect(screen.queryByText("Confirmed property")).toBeNull();
  });
});

describe("preview header", () => {
  test("shows the tenant logo named for the brand", async () => {
    renderPreview({}, "https://quote.example.com/brand/all-season-mark.svg");
    const logo = await screen.findByAltText("All Season Solar");
    expect(logo.getAttribute("src")).toBe("https://quote.example.com/brand/all-season-mark.svg");
  });

  test("falls back to the brand name when the tenant has no logo", async () => {
    renderPreview();
    expect(await screen.findByText("ALL SEASON SOLAR")).toBeTruthy();
    expect(screen.queryByAltText("All Season Solar")).toBeNull();
  });
});

describe("preview questions", () => {
  test("asks three one-tap questions, saves each answer, and supports going back", async () => {
    renderPreview();
    fireEvent.click(await screen.findByRole("button", {name: "Answer 3 quick questions"}));

    expect(screen.getByRole("heading", {name: "What made you check your roof today?"})).toBeTruthy();
    fireEvent.click(screen.getByRole("button", {name: "Storm or wind damage"}));
    expect(screen.getByRole("heading", {name: "About how old do you think the roof is?"})).toBeTruthy();

    fireEvent.click(screen.getByRole("button", {name: "Back"}));
    expect(screen.getByRole("heading", {name: "What made you check your roof today?"})).toBeTruthy();
    fireEvent.click(screen.getByRole("button", {name: "Storm or wind damage"}));
    fireEvent.click(screen.getByRole("button", {name: "15–20 years"}));
    fireEvent.click(screen.getByRole("button", {name: "ASAP"}));

    expect(await screen.findByRole("heading", {name: "Where should we send your price?"})).toBeTruthy();
    const saved = calls("/answers").map(([, init]) => JSON.parse(String(init.body)));
    expect(saved).toEqual([{reason: "storm_damage"}, {reason: "storm_damage"}, {roofAge: "15_20"}, {timeline: "asap"}]);
  });

  test("skips questions already answered", async () => {
    renderPreview({answered: ["reason", "roofAge"]});
    fireEvent.click(await screen.findByRole("button", {name: "Answer 1 quick question"}));
    expect(screen.getByRole("heading", {name: "How soon would a professional review be useful?"})).toBeTruthy();
  });
});

describe("preview contact step", () => {
  async function reachContact() {
    renderPreview({answered: ["reason", "roofAge", "timeline"]});
    fireEvent.click(await screen.findByRole("button", {name: "See my price"}));
    fireEvent.change(screen.getByLabelText("Full name"), {target: {value: "Alex Rivera"}});
    fireEvent.change(screen.getByLabelText("Email"), {target: {value: "alex@example.com"}});
    fireEvent.change(screen.getByLabelText("Mobile phone"), {target: {value: "201-555-0100"}});
  }

  test("shows the contact-only notice naming the button and records the step", async () => {
    await reachContact();
    const notice = screen.getByTestId("preview-contact-notice");
    expect(notice.textContent).toContain("By clicking “Unlock my price,” you agree that All Season Solar may contact you");
    expect(notice.querySelector("a")?.getAttribute("href")).toBe("https://allseasonroofingquote.com/privacy.html");
    expect(screen.queryAllByRole("checkbox")).toHaveLength(0);
    await waitFor(() => expect(calls("/progress").map(([, init]) => JSON.parse(String(init.body)))).toContainEqual({step: "contact_viewed"}));
  });

  test("converts the preview and continues to the price", async () => {
    fetchMock.mockImplementation(async (url: string) => String(url).includes("/convert")
      ? Response.json({accepted: true, continuationPath: "/roof-estimate/continue/abc", metaEvent: null}, {status: 202})
      : new Response(null, {status: 204}));
    await reachContact();
    fireEvent.click(screen.getByRole("button", {name: "Unlock my price"}));
    await waitFor(() => expect(assign).toHaveBeenCalledWith("/roof-estimate/continue/abc"));
    const body = JSON.parse(String(calls("/convert")[0][1].body));
    expect(body).toEqual({
      submission_id: expect.stringMatching(/^[0-9a-f-]{36}$/),
      name: "Alex Rivera",
      email: "alex@example.com",
      phone: "201-555-0100",
    });
  });

  test("reuses the submission ID when a failed request is retried", async () => {
    fetchMock.mockImplementation(async (url: string) => String(url).includes("/convert")
      ? new Response(null, {status: 503})
      : new Response(null, {status: 204}));
    await reachContact();
    fireEvent.click(screen.getByRole("button", {name: "Unlock my price"}));
    expect(await screen.findByRole("alert")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", {name: "Unlock my price"}));
    await waitFor(() => expect(calls("/convert")).toHaveLength(2));
    const ids = calls("/convert").map(([, init]) => JSON.parse(String(init.body)).submission_id);
    expect(ids[0]).toBe(ids[1]);
  });

  test("explains an expired preview", async () => {
    fetchMock.mockImplementation(async (url: string) => String(url).includes("/convert")
      ? new Response(null, {status: 404})
      : new Response(null, {status: 204}));
    await reachContact();
    fireEvent.click(screen.getByRole("button", {name: "Unlock my price"}));
    expect((await screen.findByRole("alert")).textContent).toContain("This preview has expired");
  });
});

describe("email me this", () => {
  test("saves the report email under its own notice", async () => {
    renderPreview();
    fireEvent.click(await screen.findByRole("button", {name: "Email me this roof report"}));
    expect(screen.getByTestId("preview-email-notice").textContent)
      .toBe("By clicking “Send my report,” you agree All Season Solar may email you this report and follow up about your roof. Unsubscribe anytime.");
    fireEvent.change(screen.getByLabelText("Email for your report"), {target: {value: "alex@example.com"}});
    fireEvent.click(screen.getByRole("button", {name: "Send my report"}));
    expect(await screen.findByText("Sent. Check your inbox for your roof report.")).toBeTruthy();
    expect(JSON.parse(String(calls("/save-report")[0][1].body))).toEqual({email: "alex@example.com"});
  });

  test("explains the daily limit", async () => {
    fetchMock.mockImplementation(async (url: string) => String(url).includes("/save-report")
      ? new Response(null, {status: 429})
      : new Response(null, {status: 204}));
    renderPreview();
    fireEvent.click(await screen.findByRole("button", {name: "Email me this roof report"}));
    fireEvent.change(screen.getByLabelText("Email for your report"), {target: {value: "alex@example.com"}});
    fireEvent.click(screen.getByRole("button", {name: "Send my report"}));
    expect((await screen.findByRole("alert")).textContent).toContain("already sent this report");
  });
});
