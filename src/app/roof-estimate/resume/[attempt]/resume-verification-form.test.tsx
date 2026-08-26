import {fireEvent, render, screen, waitFor} from "@testing-library/react";
import {afterEach, describe, expect, test, vi} from "vitest";
import {ResumeVerificationForm} from "./resume-verification-form";

const attemptId = "11111111-1111-4111-8111-111111111111";

afterEach(() => vi.unstubAllGlobals());

describe("ResumeVerificationForm", () => {
  test("keeps contact details private and presents one mobile-fit verification card", () => {
    render(<ResumeVerificationForm attemptId={attemptId} />);

    expect(screen.getByRole("heading", {name: "Protecting your roof assessment"})).toBeVisible();
    expect(screen.getByText(/number on file/i)).toBeVisible();
    expect(screen.queryByText(/\+1|609|555/)).not.toBeInTheDocument();
    expect(screen.getByTestId("resume-verification-card")).toHaveClass("min-h-[100svh]");
    expect(screen.getByRole("button", {name: "Send verification code"})).toBeVisible();
  });

  test("accepts only six numeric digits and exposes status through an accessible live region", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({
      status: "pending",
      cooldownSeconds: 60,
    }, {status: 202})));
    render(<ResumeVerificationForm attemptId={attemptId} />);

    fireEvent.click(screen.getByRole("button", {name: "Send verification code"}));
    const input = await screen.findByLabelText("Six-digit verification code");
    expect(input).toHaveAttribute("inputmode", "numeric");
    expect(input).toHaveAttribute("autocomplete", "one-time-code");
    fireEvent.change(input, {target: {value: "31a4 1597"}});
    expect(input).toHaveValue("314159");
    expect(screen.getByRole("status")).toHaveTextContent(/code was requested/i);
    expect(screen.getByRole("button", {name: /send again/i})).toBeDisabled();
  });

  test("redirects only after an approved response", async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(Response.json({status: "pending", cooldownSeconds: 60}, {status: 202}))
      .mockResolvedValueOnce(Response.json({status: "pending"}))
      .mockResolvedValueOnce(Response.json({
        status: "approved",
        redirectTo: "/roof-estimate/33333333-3333-4333-8333-333333333333",
      }));
    vi.stubGlobal("fetch", fetch);
    const assign = vi.fn();
    render(<ResumeVerificationForm attemptId={attemptId} onApproved={assign} />);
    fireEvent.click(screen.getByRole("button", {name: "Send verification code"}));
    const input = await screen.findByLabelText("Six-digit verification code");
    fireEvent.change(input, {target: {value: "314159"}});
    fireEvent.click(screen.getByRole("button", {name: "Verify and continue"}));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/couldn't verify/i));
    expect(assign).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", {name: "Verify and continue"}));
    await waitFor(() => expect(assign).toHaveBeenCalledWith(
      "/roof-estimate/33333333-3333-4333-8333-333333333333",
    ));
  });
});
