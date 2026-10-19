import {NextResponse} from "next/server";
import {z} from "zod";
import type {AssessmentResultRepository} from "@/modules/roof-assessment/request-consultation";
import {noStore} from "./booking-http";

type EnsureUrl = (input: {companyId: string; leadId: string}) => Promise<{url: string}>;

/**
 * The estimate token already identifies one lead, so it may exchange itself
 * for that lead's booking link. Links are reused, so repeat clicks mint nothing.
 */
export async function handleEstimateBookingLink({token, repository, available, ensureUrl}: {
  token: string;
  repository: Pick<AssessmentResultRepository, "findCompletedByToken">;
  available: (companyId: string) => Promise<boolean>;
  ensureUrl: EnsureUrl;
}) {
  const notFound = NextResponse.json({error: "Not found"}, {status: 404, headers: noStore});
  if (!z.uuid().safeParse(token).success) return notFound;
  try {
    const completed = await repository.findCompletedByToken(token);
    if (!completed?.leadId) return notFound;
    if (!(await available(completed.companyId))) return notFound;
    const {url} = await ensureUrl({companyId: completed.companyId, leadId: completed.leadId});
    return NextResponse.json({url}, {headers: noStore});
  } catch {
    return NextResponse.json({error: "Booking is temporarily unavailable"}, {status: 503, headers: noStore});
  }
}
