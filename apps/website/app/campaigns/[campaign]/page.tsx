import type {Metadata} from "next";
import {notFound} from "next/navigation";
import {CampaignLandingPage} from "../campaign-landing-page";
import {campaignSlugs, getCampaign} from "../campaigns";

export function generateStaticParams() {
  return campaignSlugs.map((campaign) => ({campaign}));
}

export async function generateMetadata({params}: {params: Promise<{campaign: string}>}): Promise<Metadata> {
  const {campaign: slug} = await params;
  const campaign = getCampaign(slug);
  if (!campaign) return {};
  return {
    title: `${campaign.name} | All Season Roofing`,
    description: campaign.intro,
    robots: {index: false, follow: false},
  };
}

export default async function CampaignPage({params}: {params: Promise<{campaign: string}>}) {
  const {campaign: slug} = await params;
  const campaign = getCampaign(slug);
  if (!campaign) notFound();
  return <CampaignLandingPage campaign={campaign} />;
}
