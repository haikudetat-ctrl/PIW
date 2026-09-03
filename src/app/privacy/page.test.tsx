import {render, screen} from "@testing-library/react";
import {describe, expect, test} from "vitest";
import {isPublicPath} from "@/middleware";
import PrivacyPage from "./page";

describe("privacy notice", () => {
  test("publishes the versioned notice and explains each consent category", () => {
    render(<PrivacyPage />);

    expect(screen.getByText("piw-privacy-v1")).toBeVisible();
    expect(screen.getByRole("heading", {name: "Necessary"})).toBeVisible();
    expect(screen.getByRole("heading", {name: "Analytics"})).toBeVisible();
    expect(screen.getByRole("heading", {name: "Advertising"})).toBeVisible();
  });

  test("explains scheduling, advertising measurement, consent evidence, and choice changes", () => {
    render(<PrivacyPage />);

    expect(screen.getByRole("heading", {name: /Cal\.com/i})).toBeVisible();
    expect(screen.getByText(/Meta Pixel and Conversions API/i)).toBeVisible();
    expect(screen.getByText(/consent evidence/i)).toBeVisible();
    expect(screen.getByText(/Privacy choices/i)).toBeVisible();
    expect(screen.getByRole("link", {name: /888.*832.*5050/})).toHaveAttribute(
      "href",
      "tel:+18888325050",
    );
  });

  test("is available without authentication", () => {
    expect(isPublicPath("/privacy")).toBe(true);
  });
});
