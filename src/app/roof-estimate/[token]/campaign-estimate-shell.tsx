import type { CSSProperties, ReactNode } from "react";
import {
  campaignThemeCssVariables,
  type CampaignTheme,
} from "@/../shared/all-season-campaign-themes";
import { roofEstimateBrand } from "@/config/roof-estimate-brand";

type CampaignEstimateShellProps = {
  theme: CampaignTheme;
  propertyMedia?: ReactNode;
  children: ReactNode;
};

function EstimateHeader() {
  return (
    <header className="campaign-estimate-header">
      <div>
        <p className="campaign-estimate-brand">{roofEstimateBrand.name}</p>
        <p className="campaign-estimate-brand-detail">New Jersey roofing specialists</p>
      </div>
      <a
        href={roofEstimateBrand.phoneHref}
        className="campaign-estimate-phone"
        aria-label={`Call ${roofEstimateBrand.name} at ${roofEstimateBrand.phoneDisplay}`}
      >
        <span>Call</span>
        <span>{roofEstimateBrand.phoneDisplay}</span>
      </a>
    </header>
  );
}

export function CampaignEstimateShell({
  theme,
  propertyMedia,
  children,
}: CampaignEstimateShellProps) {
  return (
    <main
      className="campaign-estimate-page"
      data-estimate-theme={theme.theme}
      style={campaignThemeCssVariables(theme) as CSSProperties}
    >
      {theme.artworkPath ? (
        <div
          className="campaign-estimate-art"
          style={{ backgroundImage: `url(${theme.artworkPath})` }}
          aria-hidden="true"
        />
      ) : null}
      <div className="campaign-estimate-inner">
        <EstimateHeader />
        <section
          className={`campaign-estimate-grid${
            propertyMedia ? "" : " campaign-estimate-grid--without-property"
          }`}
          aria-labelledby="estimate-heading"
        >
          {propertyMedia ? (
            <div className="campaign-estimate-property">{propertyMedia}</div>
          ) : null}
          <div className="campaign-estimate-content">{children}</div>
        </section>
      </div>
    </main>
  );
}
