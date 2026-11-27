import {describe, expect, test} from "vitest";
import {createLiveCallLimiter} from "./live-call-limit";

describe("live Solar call limit", () => {
  test("caps each user per rolling hour", () => {
    let now = 0;
    const limiter = createLiveCallLimiter(2, () => now);
    expect(limiter.tryConsume("a")).toBe(true);
    expect(limiter.tryConsume("a")).toBe(true);
    expect(limiter.tryConsume("a")).toBe(false);
    expect(limiter.tryConsume("b")).toBe(true);
    now = 60 * 60 * 1000 + 1;
    expect(limiter.tryConsume("a")).toBe(true);
  });
});
