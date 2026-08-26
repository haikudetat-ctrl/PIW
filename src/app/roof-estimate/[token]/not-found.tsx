import { neutralCampaignTheme } from "@/../shared/all-season-campaign-themes";
import { roofEstimateBrand } from "@/config/roof-estimate-brand";
import { CampaignEstimateShell } from "./campaign-estimate-shell";

export default function RoofEstimateNotFound() {
  return (
    <CampaignEstimateShell theme={neutralCampaignTheme}>
      <p className="campaign-estimate-kicker">Estimate link unavailable</p>
      <h1 id="estimate-heading" className="campaign-estimate-title">
        Let us help you find the next step.
      </h1>
      <p className="campaign-estimate-intro">
        This estimate link is invalid or no longer available. Your request may still be saved
        with our roofing team.
      </p>
      <a href={roofEstimateBrand.phoneHref} className="campaign-primary-action">
        Call {roofEstimateBrand.phoneDisplay}
      </a>
    </CampaignEstimateShell>
  );
}
