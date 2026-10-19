import {describe, expect, test} from "vitest";
import {bookingPageUrl, signBookingLink, verifyBookingLink} from "./booking-link-token";

const secret = "b".repeat(32);
const linkId = "11111111-1111-4111-8111-111111111111";

describe("booking link tokens", () => {
  test("verify only the link they were signed for", () => {
    const token = signBookingLink(linkId, secret);
    expect(verifyBookingLink(token, secret)).toBe(linkId);
    expect(verifyBookingLink(token.replace("11111111-1111", "22222222-2222"), secret)).toBeNull();
  });

  test("reject tokens signed with another secret or tampered with", () => {
    const token = signBookingLink(linkId, secret);
    expect(verifyBookingLink(token, "c".repeat(32))).toBeNull();
    expect(verifyBookingLink(`${token}x`, secret)).toBeNull();
    expect(verifyBookingLink(`${token}.extra`, secret)).toBeNull();
    expect(verifyBookingLink("not-a-token", secret)).toBeNull();
    expect(verifyBookingLink("", secret)).toBeNull();
  });

  test("refuse a short secret instead of signing weakly", () => {
    expect(() => signBookingLink(linkId, "short")).toThrow("Booking link secret is too short");
  });

  test("build the public page URL on the given host", () => {
    expect(bookingPageUrl("https://estimate.example.com", "abc.def")).toBe("https://estimate.example.com/book/abc.def");
  });
});
