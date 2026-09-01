import {existsSync, readFileSync} from "node:fs";
import {resolve} from "node:path";
import {act, render, screen} from "@testing-library/react";
import {afterEach, beforeEach, describe, expect, test, vi} from "vitest";
import {AssessmentSandbox} from "./assessment-sandbox";

describe("development assessment imagery fixtures", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("scrollTo", vi.fn());
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    window.history.replaceState({}, "", "/roof-estimate/dev-assessment");
  });

  test.each([
    ["ready", 8_000],
    ["retry", 8_000],
    ["slow", 9_000],
  ])("the %s mode renders an existing WebP fixture", async (mode, revealAtMs) => {
    window.history.replaceState(
      {},
      "",
      `/roof-estimate/dev-assessment?imagery=${mode}`,
    );
    render(<AssessmentSandbox />);

    await act(async () => vi.advanceTimersByTimeAsync(revealAtMs));

    const image = screen.getByAltText("Aerial view of 18 Harbor View Drive, Red Bank, NJ 07701");
    const source = image.getAttribute("src");
    expect(source).toBeTruthy();
    const pathname = new URL(source ?? "", "http://localhost").pathname;
    const localPath = resolve(process.cwd(), "public", pathname.replace(/^\//, ""));
    const exists = existsSync(localPath);
    expect(exists).toBe(true);
    if (!exists) return;

    const bytes = readFileSync(localPath);
    expect(bytes.subarray(0, 4).toString("ascii")).toBe("RIFF");
    expect(bytes.subarray(8, 12).toString("ascii")).toBe("WEBP");
  });
});
