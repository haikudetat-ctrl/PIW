import "server-only";
import { headers } from "next/headers";
import { roofEstimateBrand } from "@/config/roof-estimate-brand";
import { createServiceClient } from "@/lib/supabase/service";
import { resolvePublicHost } from "@/modules/tenancy/public-host";
import { createSupabasePublicHostLookup } from "@/modules/tenancy/supabase-public-host-lookup";

export type QuietBrand = {
  name: string;
  logoUrl?: string;
  phoneDisplay: string;
  phoneHref: string;
};

/**
 * Brand for the quiet estimate screens: the verified tenant host's name and
 * logo when the page is served there, otherwise the default estimate brand.
 */
export async function loadQuietBrand(): Promise<QuietBrand> {
  const fallback: QuietBrand = {
    name: roofEstimateBrand.name,
    phoneDisplay: roofEstimateBrand.phoneDisplay,
    phoneHref: roofEstimateBrand.phoneHref,
  };
  try {
    const tenant = await resolvePublicHost(
      (await headers()).get("host"),
      createSupabasePublicHostLookup(createServiceClient()),
    );
    if (!tenant) return fallback;
    return {...fallback, name: tenant.brand.displayName, logoUrl: tenant.brand.logoUrl};
  } catch {
    return fallback;
  }
}
