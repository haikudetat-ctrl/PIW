import type {Metadata} from "next";
import {headers} from "next/headers";
import {notFound} from "next/navigation";
import {createServiceClient} from "@/lib/supabase/service";
import {createBookingDependencies, resolveBookingConfiguration} from "@/modules/booking/booking-runtime";
import {loadBookingPage} from "@/modules/booking/booking-service";
import {loadBrandName} from "@/modules/booking/supabase-calendar-sync-repository";
import {resolvePublicHost} from "@/modules/tenancy/public-host";
import {createSupabasePublicHostLookup} from "@/modules/tenancy/supabase-public-host-lookup";
import {QuietHeader} from "../../roof-estimate/quiet/quiet-header";
import {BookingExperience} from "./booking-experience";
import "../../roof-estimate/quiet/quiet.css";
import "./book.css";

export const dynamic = "force-dynamic";

// The URL is a capability: keep it out of search engines and out of the
// Referer header when the homeowner follows the Meet link.
export const metadata: Metadata = {
  title: "Book your video consultation",
  robots: {index: false, follow: false},
  referrer: "no-referrer",
};

function Notice({brandName, logoUrl, title, body, phone}: {
  brandName: string;
  logoUrl?: string;
  title: string;
  body: string;
  phone: string | null;
}) {
  return (
    <main className="quiet-flow">
      <div className="quiet-frame">
        <QuietHeader brandName={brandName} logoUrl={logoUrl} />
        <section className="quiet-body">
          <h1 className="quiet-question">{title}</h1>
          <p className="quiet-lede">{body}</p>
          {phone ? (
            <a className="quiet-secondary quiet-link-button quiet-cta" href={`tel:${phone.replace(/[^\d+]/g, "")}`}>
              Call {phone}
            </a>
          ) : null}
        </section>
      </div>
    </main>
  );
}

export default async function BookingPage({params}: {params: Promise<{token: string}>}) {
  const {token} = await params;
  const configuration = resolveBookingConfiguration();
  if (!configuration) notFound();

  const client = createServiceClient();
  const dependencies = createBookingDependencies(configuration, client);
  const linkId = dependencies.verifyToken(token);
  if (!linkId) notFound();
  const link = await dependencies.repository.findLink(linkId);
  if (!link) notFound();

  // A tenant's branded host only serves its own company's links.
  const tenant = await resolvePublicHost((await headers()).get("host"), createSupabasePublicHostLookup(client));
  if (tenant && tenant.companyId !== link.companyId) notFound();
  const brandName = tenant?.brand.displayName ?? await loadBrandName(client, link.companyId);
  const logoUrl = tenant?.brand.logoUrl;

  const model = await loadBookingPage(token, dependencies);
  switch (model.kind) {
    case "invalid":
      notFound();
    case "expired":
      return (
        <Notice
          brandName={brandName}
          logoUrl={logoUrl}
          title="This booking link has expired."
          body="Give us a call and we'll find a time that works, or ask us to send you a fresh link."
          phone={model.supportPhone}
        />
      );
    case "unavailable":
      return (
        <Notice
          brandName={brandName}
          logoUrl={logoUrl}
          title="Online booking is paused right now."
          body="We can still set up your video consultation. Give us a call and we'll pick a time together."
          phone={model.supportPhone}
        />
      );
    default:
      return (
        <main className="quiet-flow">
          <div className="quiet-frame">
            <QuietHeader brandName={brandName} logoUrl={logoUrl} />
            <BookingExperience token={token} brandName={brandName} model={model} />
          </div>
        </main>
      );
  }
}
