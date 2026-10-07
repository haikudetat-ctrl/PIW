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
import { QuietHeader } from "./quiet-header";
import "./preview-quiet.css";

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
      <main className="quiet-flow">
        <div className="quiet-frame">
          <QuietHeader brandName={tenant.brand.displayName} logoUrl={tenant.brand.logoUrl} />
          <section className="quiet-body">
            <h1 className="quiet-question">Your price is on its way.</h1>
            <p className="quiet-lede">
              We sent your estimate link by text and email. Open it there to see your options.
            </p>
          </section>
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
      logoUrl={tenant.brand.logoUrl}
      privacyUrl={tenant.brand.privacyUrl}
    />
  );
}
