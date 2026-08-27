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
  });

  test("reveals the confirmed address and aerial after analysis completes", () => {
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

    fireEvent.load(screen.getByAltText("Aerial view loading for 1 Main St, Newark, NJ 07102"));
    act(() => vi.advanceTimersByTime(5_000));

    expect(screen.getByRole("heading", {name: "Property confirmed."})).toBeVisible();
    expect(screen.getByText("1 Main St, Newark, NJ 07102")).toBeVisible();
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

  test("unifies the property and assessment in one card with a correction link", () => {
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

    const card = screen.getByRole("region", {name: "Confirmed property assessment"});
    expect(card).toHaveClass("assessment-reveal-card");
    expect(card).toContainElement(screen.getByAltText("Aerial view of 1 Main St, Newark, NJ 07102"));
    expect(card).toContainElement(screen.getByRole("heading", {name: "Property confirmed."}));
    expect(screen.getByRole("link", {name: "Not your property? Update the address"}))
      .toHaveAttribute("href", "/roof-estimate");
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
    expect(fetch).not.toHaveBeenCalled();
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
