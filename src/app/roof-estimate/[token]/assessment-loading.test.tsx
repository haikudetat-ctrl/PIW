import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { assessmentLoadingStages } from "@/config/roof-assessment";
import { AssessmentLoading } from "./assessment-loading";

const props = {
  address: "1 Main St, Newark, NJ 07102",
  imageSrc: "/api/roof-estimate/11111111-1111-4111-8111-111111111111/house-image",
  imageObjectUrl: null,
  stages: assessmentLoadingStages,
};

describe("assessment analysis loading", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  test("reveals an aerial ready at one second exactly at eight seconds", () => {
    const onReady = vi.fn();
    const {rerender} = render(<AssessmentLoading {...props} onReady={onReady} />);

    act(() => vi.advanceTimersByTime(1_000));
    rerender(<AssessmentLoading {...props} imageObjectUrl="blob:ready-at-one" onReady={onReady} />);
    act(() => vi.advanceTimersByTime(6_999));
    expect(onReady).not.toHaveBeenCalled();

    act(() => vi.advanceTimersByTime(1));
    expect(onReady).toHaveBeenCalledOnce();
    expect(onReady).toHaveBeenCalledWith({
      durationMs: 8_000,
      imageAvailable: true,
      outcome: "ready_at_8s",
    });
  });

  test("reveals immediately when the aerial becomes ready at nine seconds", () => {
    const onReady = vi.fn();
    const {rerender} = render(<AssessmentLoading {...props} onReady={onReady} />);

    act(() => vi.advanceTimersByTime(8_999));
    expect(onReady).not.toHaveBeenCalled();

    act(() => vi.advanceTimersByTime(1));
    rerender(<AssessmentLoading {...props} imageObjectUrl="blob:ready-at-nine" onReady={onReady} />);
    expect(onReady).toHaveBeenCalledWith({
      durationMs: 9_000,
      imageAvailable: true,
      outcome: "ready_between_8s_12s",
    });
  });

  test("a retryable image response before twelve seconds stays nonterminal", () => {
    const onReady = vi.fn();
    render(<AssessmentLoading {...props} onReady={onReady} />);

    act(() => vi.advanceTimersByTime(11_999));

    expect(onReady).not.toHaveBeenCalled();
    expect(screen.getByRole("status")).toHaveTextContent("Preparing the assessment");
  });

  test("reveals the neutral pending state exactly at twelve seconds", () => {
    const onReady = vi.fn();
    render(<AssessmentLoading {...props} onReady={onReady} />);

    act(() => vi.advanceTimersByTime(11_999));
    expect(onReady).not.toHaveBeenCalled();

    act(() => vi.advanceTimersByTime(1));
    expect(onReady).toHaveBeenCalledOnce();
    expect(onReady).toHaveBeenCalledWith({
      durationMs: 12_000,
      imageAvailable: false,
      outcome: "pending_at_12s",
    });
  });

  test("scrolls through all four approved stages across the eight-second minimum", () => {
    render(<AssessmentLoading {...props} onReady={() => undefined} />);
    expect(screen.getByRole("status")).toHaveTextContent("Confirming the address");

    act(() => vi.advanceTimersByTime(2_000));
    expect(screen.getByRole("status")).toHaveTextContent("Locating the roof");

    act(() => vi.advanceTimersByTime(2_000));
    expect(screen.getByRole("status")).toHaveTextContent("Reviewing aerial imagery");

    act(() => vi.advanceTimersByTime(2_000));
    expect(screen.getByRole("status")).toHaveTextContent("Preparing the assessment");

    act(() => vi.advanceTimersByTime(1_999));
    expect(screen.getByRole("status")).toHaveTextContent("Preparing the assessment");
  });

  test("resets timing and completion when the image source changes", () => {
    const onReady = vi.fn();
    const {rerender} = render(<AssessmentLoading {...props} onReady={onReady} />);

    act(() => vi.advanceTimersByTime(7_000));
    rerender(
      <AssessmentLoading
        {...props}
        imageSrc={`${props.imageSrc}?source=new`}
        imageObjectUrl="blob:new-source"
        onReady={onReady}
      />,
    );
    act(() => vi.advanceTimersByTime(7_999));
    expect(onReady).not.toHaveBeenCalled();

    act(() => vi.advanceTimersByTime(1));
    expect(onReady).toHaveBeenCalledOnce();
    expect(onReady).toHaveBeenCalledWith({
      durationMs: 8_000,
      imageAvailable: true,
      outcome: "ready_at_8s",
    });
  });
});
