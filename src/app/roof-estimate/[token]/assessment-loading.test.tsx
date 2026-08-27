import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { assessmentLoadingStages } from "@/config/roof-assessment";
import { AssessmentLoading } from "./assessment-loading";

const props = {
  address: "1 Main St, Newark, NJ 07102",
  imageSrc: "/api/roof-estimate/11111111-1111-4111-8111-111111111111/house-image",
  stages: assessmentLoadingStages,
};

describe("assessment analysis loading", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  test("waits for both five seconds and aerial image readiness", () => {
    const onReady = vi.fn();
    render(<AssessmentLoading {...props} onReady={onReady} />);

    fireEvent.load(screen.getByAltText("Aerial view loading for 1 Main St, Newark, NJ 07102"));
    act(() => vi.advanceTimersByTime(4_999));
    expect(onReady).not.toHaveBeenCalled();

    act(() => vi.advanceTimersByTime(1));
    expect(onReady).toHaveBeenCalledOnce();
    expect(onReady).toHaveBeenCalledWith({imageAvailable: true});
  });

  test("keeps analyzing after five seconds while the image is pending", () => {
    const onReady = vi.fn();
    render(<AssessmentLoading {...props} onReady={onReady} />);

    act(() => vi.advanceTimersByTime(5_000));
    expect(onReady).not.toHaveBeenCalled();
    expect(screen.getByRole("status")).toHaveTextContent("Preparing the assessment");

    fireEvent.load(screen.getByAltText("Aerial view loading for 1 Main St, Newark, NJ 07102"));
    expect(onReady).toHaveBeenCalledWith({imageAvailable: true});
  });

  test("advances with an imagery fallback after twelve seconds", () => {
    const onReady = vi.fn();
    render(<AssessmentLoading {...props} onReady={onReady} />);

    act(() => vi.advanceTimersByTime(12_000));

    expect(onReady).toHaveBeenCalledOnce();
    expect(onReady).toHaveBeenCalledWith({imageAvailable: false});
  });

  test("scrolls through the four approved analysis stages", () => {
    render(<AssessmentLoading {...props} onReady={() => undefined} />);
    expect(screen.getByRole("status")).toHaveTextContent("Confirming the address");

    act(() => vi.advanceTimersByTime(1_250));
    expect(screen.getByRole("status")).toHaveTextContent("Locating the roof");

    act(() => vi.advanceTimersByTime(1_250));
    expect(screen.getByRole("status")).toHaveTextContent("Reviewing aerial imagery");

    act(() => vi.advanceTimersByTime(1_250));
    expect(screen.getByRole("status")).toHaveTextContent("Preparing the assessment");
  });

  test("treats an image error as unavailable without shortening the premium buffer", () => {
    const onReady = vi.fn();
    render(<AssessmentLoading {...props} onReady={onReady} />);

    fireEvent.error(screen.getByAltText("Aerial view loading for 1 Main St, Newark, NJ 07102"));
    act(() => vi.advanceTimersByTime(4_999));
    expect(onReady).not.toHaveBeenCalled();

    act(() => vi.advanceTimersByTime(1));
    expect(onReady).toHaveBeenCalledWith({imageAvailable: false});
  });
});
