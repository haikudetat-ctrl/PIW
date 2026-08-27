export const campaignSlugs = [
  "weather-report",
  "seasonal-shield",
  "for-every-season",
] as const;

export type CampaignSlug = (typeof campaignSlugs)[number];

type CampaignDefinition = {
  slug: CampaignSlug;
  name: string;
  kicker: string;
  headline: string;
  intro: string;
  addressTitle: string;
  addressHelp: string;
  contactTitle: string;
  contactHelp: string;
  submitLabel: string;
  image: string;
  imageAlt: string;
  driveFolderUrl: string;
  assetStatus: "ready" | "placeholder";
};

export const campaignSourceFolderUrl =
  "https://drive.google.com/drive/folders/1iO6lP366EsHPDlHvSEZrfbxAlO2xQOfC?usp=drive_link";

export const campaigns: Record<CampaignSlug, CampaignDefinition> = {
  "weather-report": {
    slug: "weather-report",
    name: "Weather Report",
    kicker: "Your free roof report",
    headline: "See what the seasons have done to your roof.",
    intro:
      "Enter your address for a measured roof estimate built around New Jersey conditions.",
    addressTitle: "Where should we check?",
    addressHelp: "Choose the New Jersey property you want us to measure.",
    contactTitle: "Where should we send your report?",
    contactHelp: "Your preliminary range will arrive by email and text.",
    submitLabel: "Check my roof",
    image: "/assets/roof-craft-detail.jpg",
    imageAlt: "A roofer inspecting the flashing and shingles on a New Jersey home",
    driveFolderUrl:
      "https://drive.google.com/drive/folders/11QE85eRS5B9803Q-BAHq9gujlhVjJ-tz",
    assetStatus: "placeholder",
  },
  "seasonal-shield": {
    slug: "seasonal-shield",
    name: "Seasonal Shield",
    kicker: "Free roof inspection and estimate",
    headline: "Protect everything under your roof.",
    intro:
      "Start with your address. We will measure the roof and prepare a clear replacement range.",
    addressTitle: "Which home are we protecting?",
    addressHelp: "Enter the New Jersey service address for your roof measurement.",
    contactTitle: "Where should we send the estimate?",
    contactHelp: "We will send the preliminary range by email and text.",
    submitLabel: "Measure my roof",
    image: "/campaigns/roof-above.jpg",
    imageAlt: "Aerial view of a neighborhood with a protection ring around a home",
    driveFolderUrl:
      "https://drive.google.com/drive/folders/1sLD-DuB69ApFYoHw6tAncw-hg7mvzxoN",
    assetStatus: "ready",
  },
  "for-every-season": {
    slug: "for-every-season",
    name: "For Every Season",
    kicker: "Roofing built for New Jersey",
    headline: "Your roof. Built for every season.",
    intro:
      "Tell us where you live. We will measure the roof and prepare your preliminary range.",
    addressTitle: "Where is the roof?",
    addressHelp: "Choose your New Jersey property to begin the measurement.",
    contactTitle: "Where should we send your range?",
    contactHelp: "We will send the preliminary result by email and text.",
    submitLabel: "Get my roof estimate",
    image: "/campaigns/every-season.jpg",
    imageAlt: "A home shown across spring, summer, fall, and winter",
    driveFolderUrl:
      "https://drive.google.com/drive/folders/12RvWglbQEvT8BPidnDGOJBqLplGI1zG2",
    assetStatus: "ready",
  },
};

export function isCampaignSlug(value: string): value is CampaignSlug {
  return campaignSlugs.includes(value as CampaignSlug);
}

export function getCampaign(value: string) {
  return isCampaignSlug(value) ? campaigns[value] : undefined;
}
