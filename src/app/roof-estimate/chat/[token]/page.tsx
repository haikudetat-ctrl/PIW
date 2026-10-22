import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { parseServerEnv } from "@/lib/env/server";
import { createServiceClient } from "@/lib/supabase/service";
import { isVirtualBookingAvailable } from "@/modules/booking/booking-runtime";
import { loadPreviewView } from "@/modules/property-preview/preview-read-model";
import { hashPreviewToken, isPreviewTokenShape } from "@/modules/property-preview/preview-token";
import { createSupabasePreviewReadDependencies } from "@/modules/property-preview/supabase-preview-read";
import { resolvePublicHost } from "@/modules/tenancy/public-host";
import { createSupabasePublicHostLookup } from "@/modules/tenancy/supabase-public-host-lookup";
import { loadQuietBrand } from "../../quiet/quiet-brand";
import { QuoteChat } from "./quote-chat";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Your roof estimate",
  robots: {index: false, follow: false},
};

function chatEnabled() {
  try {
    return parseServerEnv(process.env).QUOTE_CHAT_ENABLED;
  } catch {
    return false;
  }
}

// The quote chat continues a preview the website's chat started. With the
// chat switched off, the same preview opens in the classic value-first flow.
export default async function QuoteChatPage({params}: {params: Promise<{token: string}>}) {
  const {token} = await params;
  if (!isPreviewTokenShape(token)) notFound();
  if (!chatEnabled()) redirect(`/roof-estimate/p/${token}`);

  const service = createServiceClient();
  const tenant = await resolvePublicHost((await headers()).get("host"), createSupabasePublicHostLookup(service));
  if (!tenant) notFound();

  const view = await loadPreviewView(
    {companyId: tenant.companyId, tokenHash: hashPreviewToken(token)},
    createSupabasePreviewReadDependencies(service),
  );
  if (!view) notFound();

  const [brand, bookingAvailable] = await Promise.all([
    loadQuietBrand(),
    isVirtualBookingAvailable(service, tenant.companyId).catch(() => false),
  ]);

  return (
    <QuoteChat
      token={token}
      initialView={view}
      brand={brand}
      privacyUrl={tenant.brand.privacyUrl}
      bookingAvailable={bookingAvailable}
    />
  );
}
