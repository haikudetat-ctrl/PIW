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
    expect(screen.getByRole("link", {name: /856.*835.*6022/})).toHaveAttribute(
      "href",
      "tel:+18568356022",
    );
  });

  test("publishes the text-message terms carriers require for A2P 10DLC", () => {
    render(<PrivacyPage />);

    const section = screen.getByRole("region", {name: "Text messages"});
    expect(section).toHaveAttribute("id", "text-messages");
    expect(section).toHaveTextContent(/Message frequency varies\. Message and data rates may apply\./);
    expect(section).toHaveTextContent(/Reply HELP for help or STOP/);
    expect(section).toHaveTextContent(/Reply START to resume/);
    expect(section).toHaveTextContent(
      /do not sell, rent, or share your mobile number or text-message consent with\s+third parties or affiliates/,
    );
  });

  test("is available without authentication", () => {
    expect(isPublicPath("/privacy")).toBe(true);
  });
});
