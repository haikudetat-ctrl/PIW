import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import {useContext} from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { getRoofAssessmentContext } from "@/config/roof-assessment";
import { AssessmentExperience } from "./assessment-experience";
import {AssessmentRevisionContext} from "./assessment-revision-context";

const token = "11111111-1111-4111-8111-111111111111";
const imageUrl = `/api/roof-estimate/${token}/house-image`;
const context = getRoofAssessmentContext("for-every-season");

function RevisionProbe() {
  const revision = useContext(AssessmentRevisionContext);
  return <p>Questionnaire revision {revision}</p>;
}

describe("assessment property reveal", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("scrollTo", vi.fn());
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  test("reveals the confirmed address and fetched aerial after eight seconds", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(new Uint8Array([1, 2, 3]), {
      status: 200,
      headers: {"content-type": "image/jpeg"},
    })));
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:confirmed-aerial");
    render(
      <AssessmentExperience
        token={token}
        address="1 Main St, Newark, NJ 07102"
        imageUrl={imageUrl}
        context={context}
        initialPropertyRevealed={false}
        initialStep={0}
      >
        <p>Questions begin here</p>
      </AssessmentExperience>,
    );

    await act(async () => undefined);
    act(() => vi.advanceTimersByTime(7_999));
    expect(screen.queryByRole("heading", {name: "Property confirmed."})).not.toBeInTheDocument();

    act(() => vi.advanceTimersByTime(1));

    expect(screen.getByRole("heading", {name: "Property confirmed."})).toBeVisible();
    expect(screen.getByText("1 Main St, Newark, NJ 07102")).toBeVisible();
    expect(screen.getByAltText("Aerial view of 1 Main St, Newark, NJ 07102"))
      .toHaveAttribute("src", "blob:confirmed-aerial");
    expect(screen.getByRole("button", {name: "Start my assessment"})).toBeEnabled();
  });

  test("skips the analysis buffer after the property reveal was saved", () => {
    render(
      <AssessmentExperience
        token={token}
        address="1 Main St, Newark, NJ 07102"
        imageUrl={imageUrl}
        context={context}
        initialPropertyRevealed
        initialStep={0}
      >
        <p>Questions begin here</p>
      </AssessmentExperience>,
    );

    expect(screen.queryByText("Analyzing your property.")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", {name: "Property confirmed."})).toBeVisible();
  });

  test("provides a resumed nonzero revision directly to the questionnaire stage", () => {
    render(
      <AssessmentExperience
        token={token}
        address="1 Main St, Newark, NJ 07102"
        imageUrl={imageUrl}
        context={context}
        initialPropertyRevealed
        initialStep={4}
        initialRevision={7}
      >
        <RevisionProbe />
      </AssessmentExperience>,
    );

    expect(screen.getByText("Questionnaire revision 7")).toBeVisible();
  });

  test("unifies the property and assessment in one card with a correction link", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(new Uint8Array([1]), {
      status: 200,
      headers: {"content-type": "image/jpeg"},
    })));
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:summary-aerial");
    render(
      <AssessmentExperience
        token={token}
        address="1 Main St, Newark, NJ 07102"
        imageUrl={imageUrl}
        context={context}
        initialPropertyRevealed
        initialStep={0}
      >
        <p>Questions begin here</p>
      </AssessmentExperience>,
    );
    await act(async () => undefined);

    const card = screen.getByRole("region", {name: "Confirmed property assessment"});
    expect(card).toHaveClass("assessment-reveal-card");
    expect(card).toContainElement(screen.getByAltText("Aerial view of 1 Main St, Newark, NJ 07102"));
    expect(card).toContainElement(screen.getByRole("heading", {name: "Property confirmed."}));
    expect(screen.getByRole("link", {name: "Not your property? Update the address"}))
      .toHaveAttribute("href", "/roof-estimate");
  });

  test("shows one neutral in-box imagery status without a fallback campaign roof", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(
      JSON.stringify({error: "Property image unavailable"}),
      {status: 404, headers: {"content-type": "application/json"}},
    )));
    render(
      <AssessmentExperience
        token={token}
        address="1 Main St, Newark, NJ 07102"
        imageUrl={imageUrl}
        context={context}
        initialPropertyRevealed
        initialStep={0}
      >
        <p>Questions begin here</p>
      </AssessmentExperience>,
    );

    await act(async () => undefined);

    expect(screen.getByRole("status")).toHaveTextContent("Finalizing your property imagery");
    expect(screen.getAllByRole("status")).toHaveLength(1);
    expect(screen.queryByAltText(context.fallbackImageAlt)).not.toBeInTheDocument();
    expect(screen.queryByTestId("assessment-aerial-image")).not.toBeInTheDocument();
    expect(screen.getByRole("link", {name: "Not your property? Update the address"})).toBeVisible();
    expect(screen.getByRole("button", {name: "Start my assessment"})).toBeEnabled();
  });

  test("opens the usable pending confirmation exactly at the twelve-second cap", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, {status: 404})));
    render(
      <AssessmentExperience
        token={token}
        address="1 Main St, Newark, NJ 07102"
        imageUrl={imageUrl}
        context={context}
        initialPropertyRevealed={false}
        initialStep={0}
      >
        <p>Questions begin here</p>
      </AssessmentExperience>,
    );

    await act(async () => vi.advanceTimersByTimeAsync(11_999));
    expect(screen.queryByRole("heading", {name: "Property confirmed."})).not.toBeInTheDocument();

    await act(async () => vi.advanceTimersByTimeAsync(1));
    expect(screen.getByRole("status")).toHaveTextContent("Finalizing your property imagery");
    expect(screen.getByRole("link", {name: "Not your property? Update the address"})).toBeVisible();
    expect(screen.getByRole("button", {name: "Start my assessment"})).toBeEnabled();
  });

  test("retries the same token-scoped route after 2.5 seconds and swaps in the real aerial", async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(new Response(null, {status: 502}))
      .mockResolvedValueOnce(new Response(new Uint8Array([1]), {
        status: 200,
        headers: {"content-type": "image/jpeg"},
      }));
    vi.stubGlobal("fetch", fetch);
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:retry-ready");
    render(
      <AssessmentExperience
        token={token}
        address="1 Main St, Newark, NJ 07102"
        imageUrl={imageUrl}
        context={context}
        initialPropertyRevealed
        initialStep={0}
      >
        <p>Questions begin here</p>
      </AssessmentExperience>,
    );

    await act(async () => undefined);
    expect(fetch).toHaveBeenNthCalledWith(1, imageUrl, {signal: expect.any(AbortSignal)});

    await act(async () => vi.advanceTimersByTimeAsync(2_500));

    expect(fetch).toHaveBeenNthCalledWith(2, `${imageUrl}?aerial_retry=1`, {
      signal: expect.any(AbortSignal),
    });
    expect(screen.getByAltText("Aerial view of 1 Main St, Newark, NJ 07102"))
      .toHaveAttribute("src", "blob:retry-ready");
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  test("appends only aerial_retry when the scoped image route already has a query", async () => {
    const scopedImageUrl = `${imageUrl}?variant=assessment`;
    const fetch = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => (
      new Response(null, {status: 502})
    ));
    vi.stubGlobal("fetch", fetch);
    render(
      <AssessmentExperience
        token={token}
        address="1 Main St, Newark, NJ 07102"
        imageUrl={scopedImageUrl}
        context={context}
        initialPropertyRevealed
        initialStep={0}
      >
        <p>Questions begin here</p>
      </AssessmentExperience>,
    );

    await act(async () => undefined);
    await act(async () => vi.advanceTimersByTimeAsync(2_500));

    expect(fetch.mock.calls[1]?.[0]).toBe(`${scopedImageUrl}&aerial_retry=1`);
  });

  test("stops after 36 post-reveal retries", async () => {
    const fetch = vi.fn(async () => new Response(null, {status: 502}));
    vi.stubGlobal("fetch", fetch);
    render(
      <AssessmentExperience
        token={token}
        address="1 Main St, Newark, NJ 07102"
        imageUrl={imageUrl}
        context={context}
        initialPropertyRevealed
        initialStep={0}
      >
        <p>Questions begin here</p>
      </AssessmentExperience>,
    );

    await act(async () => undefined);
    await act(async () => vi.advanceTimersByTimeAsync(36 * 2_500));

    expect(fetch).toHaveBeenCalledTimes(37);
    await act(async () => vi.advanceTimersByTimeAsync(2_500));
    expect(fetch).toHaveBeenCalledTimes(37);
  });

  test("rebases a long loading retry to 2.5 seconds after the twelve-second reveal", async () => {
    const fetch = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(null, {
      status: 502,
      headers: {"retry-after": fetch.mock.calls.length === 1 ? "10" : "7"},
    }));
    vi.stubGlobal("fetch", fetch);
    render(
      <AssessmentExperience
        token={token}
        address="1 Main St, Newark, NJ 07102"
        imageUrl={imageUrl}
        context={context}
        initialPropertyRevealed={false}
        initialStep={0}
      >
        <p>Questions begin here</p>
      </AssessmentExperience>,
    );

    await act(async () => undefined);
    expect(fetch).toHaveBeenCalledTimes(1);
    await act(async () => vi.advanceTimersByTimeAsync(10_000));
    expect(fetch).toHaveBeenCalledTimes(2);

    await act(async () => vi.advanceTimersByTimeAsync(2_000));
    expect(screen.getByRole("status")).toHaveTextContent("Finalizing your property imagery");
    await act(async () => vi.advanceTimersByTimeAsync(2_499));
    expect(fetch).toHaveBeenCalledTimes(2);

    await act(async () => vi.advanceTimersByTimeAsync(1));
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(fetch.mock.calls[2]?.[0]).toBe(`${imageUrl}?aerial_retry=2`);

    await act(async () => vi.advanceTimersByTimeAsync(2_500));
    expect(fetch).toHaveBeenCalledTimes(4);
    await act(async () => vi.advanceTimersByTimeAsync(34 * 2_500));
    expect(fetch).toHaveBeenCalledTimes(38);
    await act(async () => vi.advanceTimersByTimeAsync(2_500));
    expect(fetch).toHaveBeenCalledTimes(38);
  });

  test("revokes replaced and unmounted aerial object URLs", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(new Uint8Array([1]), {
      status: 200,
      headers: {"content-type": "image/jpeg"},
    })));
    vi.spyOn(URL, "createObjectURL")
      .mockReturnValueOnce("blob:first-aerial")
      .mockReturnValueOnce("blob:second-aerial");
    const revokeObjectURL = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    const {rerender, unmount} = render(
      <AssessmentExperience
        token={token}
        address="1 Main St, Newark, NJ 07102"
        imageUrl={imageUrl}
        context={context}
        initialPropertyRevealed
        initialStep={0}
      >
        <p>Questions begin here</p>
      </AssessmentExperience>,
    );
    await act(async () => undefined);

    rerender(
      <AssessmentExperience
        token={token}
        address="1 Main St, Newark, NJ 07102"
        imageUrl={`${imageUrl}?variant=new-source`}
        context={context}
        initialPropertyRevealed
        initialStep={0}
      >
        <p>Questions begin here</p>
      </AssessmentExperience>,
    );
    await act(async () => undefined);

    expect(revokeObjectURL).toHaveBeenCalledWith("blob:first-aerial");
    unmount();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:second-aerial");
  });

  test("aborts in-flight aerial requests on source change and unmount", async () => {
    const requestSignals: AbortSignal[] = [];
    vi.stubGlobal("fetch", vi.fn((_url: RequestInfo | URL, init?: RequestInit) => {
      if (init?.signal) requestSignals.push(init.signal);
      return new Promise<Response>(() => undefined);
    }));
    const {rerender, unmount} = render(
      <AssessmentExperience
        token={token}
        address="1 Main St, Newark, NJ 07102"
        imageUrl={imageUrl}
        context={context}
        initialPropertyRevealed
        initialStep={0}
      >
        <p>Questions begin here</p>
      </AssessmentExperience>,
    );

    expect(requestSignals[0]?.aborted).toBe(false);
    rerender(
      <AssessmentExperience
        token={token}
        address="1 Main St, Newark, NJ 07102"
        imageUrl={`${imageUrl}?source=new`}
        context={context}
        initialPropertyRevealed
        initialStep={0}
      >
        <p>Questions begin here</p>
      </AssessmentExperience>,
    );
    expect(requestSignals[0]?.aborted).toBe(true);
    expect(requestSignals[1]?.aborted).toBe(false);

    unmount();
    expect(requestSignals[1]?.aborted).toBe(true);
  });

  test("groups the confirmation hierarchy as one property summary", () => {
    render(
      <AssessmentExperience
        token={token}
        address="1 Main St, Newark, NJ 07102"
        imageUrl={imageUrl}
        context={context}
        initialPropertyRevealed
        initialStep={0}
      >
        <p>Questions begin here</p>
      </AssessmentExperience>,
    );

    const summary = screen.getByRole("group", {name: "Confirmed property summary"});
    expect(summary).toContainElement(screen.getByText(context.kicker));
    expect(summary).toContainElement(screen.getByRole("heading", {name: "Property confirmed."}));
    expect(summary).toContainElement(screen.getByText(context.headline));
  });

  test("persists the reveal before opening the questions", async () => {
    vi.useRealTimers();
    const fetch = vi.fn(async () => Response.json({propertyRevealed: true, revision: 4}));
    vi.stubGlobal("fetch", fetch);
    render(
      <AssessmentExperience
        token={token}
        address="1 Main St, Newark, NJ 07102"
        imageUrl={imageUrl}
        context={context}
        initialPropertyRevealed
        initialStep={0}
        initialRevision={3}
      >
        <p>Questions begin here</p>
      </AssessmentExperience>,
    );

    fireEvent.click(screen.getByRole("button", {name: "Start my assessment"}));

    await waitFor(() => expect(fetch).toHaveBeenCalledWith(`/api/roof-estimate/${token}/assessment`, {
        method: "PATCH",
        headers: {"content-type": "application/json"},
        body: JSON.stringify({
          expectedRevision: 3,
          questionId: null,
          propertyRevealed: true,
          responsePatch: {},
        }),
      }));
    expect(await screen.findByText("Questions begin here")).toBeVisible();
  });

  test("opens the questions without persistence in the development preview", () => {
    const fetch = vi.fn();
    const scrollTo = vi.fn();
    vi.stubGlobal("fetch", fetch);
    vi.stubGlobal("scrollTo", scrollTo);
    render(
      <AssessmentExperience
        preview
        token={token}
        address="1 Main St, Newark, NJ 07102"
        imageUrl={imageUrl}
        context={context}
        initialPropertyRevealed
        initialStep={0}
      >
        <p>Questions begin here</p>
      </AssessmentExperience>,
    );

    fireEvent.click(screen.getByRole("button", {name: "Start my assessment"}));

    expect(screen.getByText("Questions begin here")).toBeVisible();
    expect(fetch).not.toHaveBeenCalledWith(`/api/roof-estimate/${token}/assessment`, expect.anything());
    expect(scrollTo).toHaveBeenCalledWith({top: 0, behavior: "smooth"});
  });

  test("keeps the reveal visible when progress cannot be saved", async () => {
    vi.useRealTimers();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, {status: 503})));
    render(
      <AssessmentExperience
        token={token}
        address="1 Main St, Newark, NJ 07102"
        imageUrl={imageUrl}
        context={context}
        initialPropertyRevealed
        initialStep={0}
      >
        <p>Questions begin here</p>
      </AssessmentExperience>,
    );

    fireEvent.click(screen.getByRole("button", {name: "Start my assessment"}));

    expect(await screen.findByRole("alert")).toHaveTextContent("We could not save your progress");
    expect(screen.getByRole("button", {name: "Try again"})).toBeEnabled();
  });
});
