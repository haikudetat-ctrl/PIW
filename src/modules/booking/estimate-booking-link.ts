import {NextResponse} from "next/server";
import {z} from "zod";
import {noStore} from "./booking-http";

type EnsureUrl = (input: {companyId: string; leadId: string}) => Promise<{url: string}>;

export type EstimateLeadLookup = {
  /** The lead an estimate token belongs to, whether or not its assessment is finished. */
  findLeadByEstimateToken(token: string): Promise<{companyId: string; leadId: string} | null>;
};

/** The link token is the last path segment of a /book/<token> URL. */
export function bookingTokenFromUrl(url: string) {
  try {
    const {pathname} = new URL(url);
    return pathname.startsWith("/book/") ? decodeURIComponent(pathname.slice("/book/".length)) : null;
  } catch {
    return null;
  }
}

/**
 * The estimate token already identifies one lead, so it may exchange itself
 * for that lead's booking link. Price-first homeowners (including the quote
 * chat) have no finished assessment, and the estimate page's holder can already
 * see more than the booking page shows, so the assessment state doesn't matter.
 * Links are reused, so repeat calls mint nothing.
 */
export async function handleEstimateBookingLink({token, repository, available, ensureUrl}: {
  token: string;
  repository: EstimateLeadLookup;
  available: (companyId: string) => Promise<boolean>;
  ensureUrl: EnsureUrl;
}) {
  const notFound = NextResponse.json({error: "Not found"}, {status: 404, headers: noStore});
  if (!z.uuid().safeParse(token).success) return notFound;
  try {
    const lead = await repository.findLeadByEstimateToken(token);
    if (!lead) return notFound;
    if (!(await available(lead.companyId))) return notFound;
    const {url} = await ensureUrl(lead);
    return NextResponse.json({url, token: bookingTokenFromUrl(url)}, {headers: noStore});
  } catch {
    return NextResponse.json({error: "Booking is temporarily unavailable"}, {status: 503, headers: noStore});
  }
}
