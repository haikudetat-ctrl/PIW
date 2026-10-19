import "server-only";
import type {SupabaseClient} from "@supabase/supabase-js";
import type {DomainEvent} from "@/domain/events";
import {inngest} from "@/inngest/client";
import type {Database} from "@/lib/database.types";
import {parseServerEnv} from "@/lib/env/server";
import {createServiceClient} from "@/lib/supabase/service";
import {enqueueAndPublishEvent} from "@/modules/events/enqueue-and-publish-event";
import {SupabaseOutboxRepository} from "@/modules/events/supabase-outbox-repository";
import {findVerifiedPublicHost} from "@/modules/property-preview/supabase-preview-repository";
import {bookingPageUrl, signBookingLink, verifyBookingLink} from "./booking-link-token";
import type {BookingDependencies} from "./booking-service";
import {GoogleAccessTokenProvider, GoogleCalendarClient, parseServiceAccountJson} from "./google-calendar";
import {SupabaseBookingRepository} from "./supabase-booking-repository";

// Composition root for virtual consultation booking. Returns null when the
// feature is switched off, which every caller treats as "not found" so a
// half-configured deployment never shows homeowners a broken page.

export type BookingRuntimeConfiguration = {
  signingSecret: string;
  calendar: GoogleCalendarClient;
  fromEmail: string | null;
  resendApiKey: string | null;
  appBaseUrl: string | null;
};

export function resolveBookingConfiguration(): BookingRuntimeConfiguration | null {
  const environment = parseServerEnv(process.env);
  if (
    !environment.VIRTUAL_BOOKING_ENABLED
    || !environment.BOOKING_LINK_SIGNING_SECRET
    || !environment.GOOGLE_CALENDAR_SERVICE_ACCOUNT_JSON
    || !environment.GOOGLE_CALENDAR_DELEGATED_USER
  ) {
    return null;
  }
  let account;
  try {
    account = parseServiceAccountJson(environment.GOOGLE_CALENDAR_SERVICE_ACCOUNT_JSON);
  } catch (error) {
    // A broken key file switches booking off rather than breaking the pages.
    console.error("booking_configuration_invalid", {error: error instanceof Error ? error.message : "unknown"});
    return null;
  }
  const productionUrl = environment.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  return {
    signingSecret: environment.BOOKING_LINK_SIGNING_SECRET,
    calendar: new GoogleCalendarClient(new GoogleAccessTokenProvider(account, environment.GOOGLE_CALENDAR_DELEGATED_USER)),
    fromEmail: environment.BOOKING_FROM_EMAIL ?? null,
    resendApiKey: environment.RESEND_API_KEY ?? null,
    appBaseUrl: productionUrl ? (productionUrl.startsWith("http") ? productionUrl : `https://${productionUrl}`) : null,
  };
}

export function createBookingDependencies(
  configuration: BookingRuntimeConfiguration,
  client: SupabaseClient<Database> = createServiceClient(),
): BookingDependencies {
  return {
    repository: new SupabaseBookingRepository(client),
    calendar: configuration.calendar,
    verifyToken: (token) => verifyBookingLink(token, configuration.signingSecret),
    async publish(event: DomainEvent, companyId: string) {
      await enqueueAndPublishEvent({
        repository: new SupabaseOutboxRepository(client),
        event,
        companyId,
        eventAlreadyPersisted: true,
        send: (outbound) => inngest.send(outbound),
      });
    },
    now: () => new Date(),
    logError: (message, context) => console.error(message, context),
  };
}

/**
 * The homeowner-facing URL for a booking link: the company's verified public
 * host (the branded estimate domain) when it has one, otherwise the app.
 */
export async function buildBookingUrl(
  client: SupabaseClient<Database>,
  configuration: Pick<BookingRuntimeConfiguration, "signingSecret" | "appBaseUrl">,
  companyId: string,
  linkId: string,
): Promise<string | null> {
  const host = await findVerifiedPublicHost(client, companyId);
  const base = host ? `https://${host}` : configuration.appBaseUrl;
  if (!base) return null;
  return bookingPageUrl(base, signBookingLink(linkId, configuration.signingSecret));
}

/** True when homeowners of this company can self-book right now. */
export async function isVirtualBookingAvailable(client: SupabaseClient<Database>, companyId: string) {
  if (!resolveBookingConfiguration()) return false;
  const {data} = await client
    .from("booking_settings")
    .select("is_enabled, google_calendar_id")
    .eq("company_id", companyId)
    .maybeSingle();
  return Boolean(data?.is_enabled && data.google_calendar_id);
}

/** Issues (or reuses) the lead's booking link and returns its public URL. */
export async function ensureBookingUrl(input: {
  client: SupabaseClient<Database>;
  configuration: Pick<BookingRuntimeConfiguration, "signingSecret" | "appBaseUrl">;
  companyId: string;
  leadId: string;
  source: "staff" | "estimate_result" | "proposal";
  createdBy: string | null;
}) {
  const {data, error} = await input.client.rpc("ensure_booking_link", {
    p_company_id: input.companyId,
    p_lead_id: input.leadId,
    p_source: input.source,
    p_created_by: input.createdBy as string,
  });
  const row = data?.[0];
  if (error || !row) throw new Error("Failed to issue a booking link");
  const url = await buildBookingUrl(input.client, input.configuration, input.companyId, row.link_id);
  if (!url) throw new Error("No public host is configured for booking links");
  return {url, expiresAt: row.expires_at};
}
