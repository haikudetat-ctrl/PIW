import { describe, expect, test } from "vitest";
import { contactOnlyNotice, propertyProcessingNotice } from "./notices";

describe("preview notices", () => {
  test("the address notice names its button and covers only property processing", () => {
    const notice = propertyProcessingNotice("All Season Solar");
    expect(notice).toBe("By clicking “See my roof,” you authorize All Season Solar to review this address using property records, maps, and imagery.");
    expect(notice).not.toMatch(/call|text|email/i);
  });

  test("the contact notice names its button and covers calls, texts and email but not property processing", () => {
    const notice = contactOnlyNotice("All Season Solar");
    expect(notice.startsWith("By clicking “Unlock my price,”")).toBe(true);
    expect(notice).toContain("autodialed calls, prerecorded or artificial voice messages, and automated texts");
    expect(notice).toContain("Consent is not required to purchase.");
    expect(notice).toContain("Reply STOP to opt out.");
    expect(notice).not.toMatch(/property records|imagery/);
  });
});
