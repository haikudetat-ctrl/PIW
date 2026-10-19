import "server-only";
import {createHmac, timingSafeEqual} from "node:crypto";
import {z} from "zod";

// A booking link URL carries the link ID plus an HMAC of it. The database
// stores no secret, so PIW can rebuild a homeowner's link for a reminder
// email from the row alone, and a leaked row is not a working URL. Rotating
// BOOKING_LINK_SIGNING_SECRET invalidates every outstanding link.

const PURPOSE = "booking-link:v1";
const MINIMUM_SECRET_BYTES = 32;

function signature(linkId: string, secret: string) {
  return createHmac("sha256", secret).update(`${PURPOSE}:${linkId}`, "utf8").digest("base64url");
}

function assertSecret(secret: string) {
  if (Buffer.byteLength(secret, "utf8") < MINIMUM_SECRET_BYTES) {
    throw new Error("Booking link secret is too short");
  }
}

export function signBookingLink(linkId: string, secret: string) {
  assertSecret(secret);
  const id = z.uuid().parse(linkId);
  return `${id}.${signature(id, secret)}`;
}

/** The link ID when the token is genuine, otherwise null. Never throws on input. */
export function verifyBookingLink(token: string, secret: string): string | null {
  assertSecret(secret);
  if (typeof token !== "string" || token.length > 200) return null;
  const [linkId, provided, extra] = token.split(".");
  if (extra !== undefined || !linkId || !provided || !z.uuid().safeParse(linkId).success) return null;
  const expected = Buffer.from(signature(linkId, secret));
  const actual = Buffer.from(provided);
  return actual.length === expected.length && timingSafeEqual(actual, expected) ? linkId : null;
}

export function bookingPageUrl(baseUrl: string, token: string) {
  return new URL(`/book/${encodeURIComponent(token)}`, baseUrl).toString();
}
