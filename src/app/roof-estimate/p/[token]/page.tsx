import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { getRoofAssessmentContext } from "@/config/roof-assessment";
import { createServiceClient } from "@/lib/supabase/service";
import { loadPreviewView } from "@/modules/property-preview/preview-read-model";
import { hashPreviewToken, isPreviewTokenShape } from "@/modules/property-preview/preview-token";
import { createSupabasePreviewReadDependencies } from "@/modules/property-preview/supabase-preview-read";
import { resolvePublicHost } from "@/modules/tenancy/public-host";
import { createSupabasePublicHostLookup } from "@/modules/tenancy/supabase-public-host-lookup";
import { PreviewExperience } from "./preview-experience";

export const dynamic = "force-dynamic";

export const metadata = {
  robots: {index: false, follow: false},
};

export default async function PropertyPreviewPage({params}: {params: Promise<{token: string}>}) {
  const {token} = await params;
  if (!isPreviewTokenShape(token)) notFound();

  const service = createServiceClient();
  const tenant = await resolvePublicHost((await headers()).get("host"), createSupabasePublicHostLookup(service));
  if (!tenant) notFound();

  const view = await loadPreviewView(
    {companyId: tenant.companyId, tokenHash: hashPreviewToken(token)},
    createSupabasePreviewReadDependencies(service),
  );
  if (!view) notFound();

  if (view.status === "converted") {
    return (
      <main className="grid min-h-[100dvh] place-items-center bg-[#edf2f3] px-4 text-slate-950">
        <div className="max-w-md text-center">
          <h1 className="text-3xl font-semibold tracking-[-0.03em]">Your price is on its way.</h1>
          <p className="mt-4 text-base leading-7 text-slate-600">
            We sent your estimate link by text and email. Open it there to see your options.
          </p>
        </div>
      </main>
    );
  }

  return (
    <PreviewExperience
      token={token}
      initialView={view}
      context={getRoofAssessmentContext(view.campaign ?? view.presentationKey)}
      brandName={tenant.brand.displayName}
      privacyUrl={tenant.brand.privacyUrl}
    />
  );
}
