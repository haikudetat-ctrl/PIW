import { render, screen } from "@testing-library/react";
import { buildEstimateResultModel } from "./estimate-result-model";
import { CampaignResultContent } from "./campaign-result-content";

test("puts the ready estimate before the supporting story", () => {
  const model = buildEstimateResultModel({
    estimate: {
      status: "ready",
      range_low_cents: 1800000,
      range_high_cents: 2400000,
      roof_squares: 31.4,
    },
    pipelineStatus: "complete",
    canonicalAddress: "12 Birch Street, Newark, NJ",
    submittedAddress: null,
    campaign: "do-it-right-once",
  });

  render(<CampaignResultContent model={model} />);

  const range = screen.getByText("$18,000 to $24,000");
  const trust = screen.getByRole("heading", { name: /accountability/i });
  expect(
    range.compareDocumentPosition(trust) & Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
  expect(
    screen.getByRole("link", { name: /schedule the roof inspection/i }),
  ).toBeVisible();
  expect(screen.getByText(/preliminary estimate/i)).toBeVisible();
});

test("keeps an unavailable estimate actionable and provider-neutral", () => {
  const model = buildEstimateResultModel({
    estimate: {
      status: "failed",
      range_low_cents: null,
      range_high_cents: null,
      roof_squares: null,
    },
    pipelineStatus: "failed",
    canonicalAddress: null,
    submittedAddress: "8 Shore Road, Toms River, NJ",
    campaign: "seasonal-shield",
  });

  render(<CampaignResultContent model={model} />);

  expect(screen.getByRole("link", { name: /call/i })).toHaveAttribute(
    "href",
    "tel:+18888325050",
  );
  expect(screen.queryByText(/Google Solar|API|pipeline|provider/i)).not.toBeInTheDocument();
});

test("keeps manual review reassuring, actionable, and provider-neutral", () => {
  const model = buildEstimateResultModel({
    estimate: {
      status: "review_required",
      range_low_cents: null,
      range_high_cents: null,
      roof_squares: null,
    },
    pipelineStatus: "review_required",
    canonicalAddress: "46 Oak Lane, Cherry Hill, NJ",
    submittedAddress: null,
    campaign: "weather-report",
  });

  render(<CampaignResultContent model={model} />);

  expect(screen.getByRole("heading", { name: /checking the property match/i })).toBeVisible();
  expect(screen.getByRole("link", { name: /call/i })).toHaveAttribute(
    "href",
    "tel:+18888325050",
  );
  expect(screen.queryByText(/Google Solar|API|pipeline|provider/i)).not.toBeInTheDocument();
});
