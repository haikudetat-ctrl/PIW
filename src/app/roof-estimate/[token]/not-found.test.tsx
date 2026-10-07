import { render, screen } from "@testing-library/react";
import RoofEstimateNotFound from "./not-found";

test("keeps an invalid estimate link branded, helpful, and implementation-neutral", () => {
  render(<RoofEstimateNotFound />);

  expect(
    screen.getByRole("heading", { name: "Let us help you find the next step." }),
  ).toBeVisible();
  expect(screen.getByText("AllSeason Solar & Roofing")).toBeVisible();
  expect(screen.getByRole("link", { name: /call \(856\) 835-6022/i })).toHaveAttribute(
    "href",
    "tel:+18568356022",
  );
  expect(document.body).not.toHaveTextContent(
    /token|database|Supabase|\bAPI\b|stack trace/i,
  );
});
