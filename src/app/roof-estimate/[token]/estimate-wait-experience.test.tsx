import { render, screen } from "@testing-library/react";
import { campaignThemes } from "../../../../shared/all-season-campaign-themes";
import { EstimateWaitExperience } from "./estimate-wait-experience";

test("shows honest homeowner-facing processing stages", () => {
  render(<EstimateWaitExperience theme={campaignThemes["seasonal-shield"]} />);
  expect(screen.getByText("Confirming the property")).toBeInTheDocument();
  expect(screen.getByText("Measuring the roof")).toBeInTheDocument();
  expect(screen.getByText("Preparing the estimate")).toBeInTheDocument();
  expect(screen.queryByText(/API|provider|pipeline/i)).not.toBeInTheDocument();
});

test("keeps manual review branded and actionable", () => {
  render(<EstimateWaitExperience theme={campaignThemes["weather-report"]} manualReview />);
  expect(screen.getByText(/roofing professional is checking/i)).toBeInTheDocument();
  expect(screen.getByRole("link", { name: /call/i })).toHaveAttribute(
    "href",
    "tel:+18888325050",
  );
});
