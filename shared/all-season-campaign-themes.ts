export const campaignSlugs = [
  "do-it-right-once",
  "weather-report",
  "seasonal-shield",
  "for-every-season",
] as const;

export type CampaignSlug = (typeof campaignSlugs)[number];

export type CampaignTheme = {
  slug: CampaignSlug | "all-season";
  theme: "heritage" | "forecast" | "shield" | "seasons" | "neutral";
  background: string;
  surface: string;
  text: string;
  muted: string;
  accent: string;
  accentContrast: string;
  artworkPath: string | null;
  loadingStatement: string;
  resultHeadline: string;
  trustHeadline: string;
  trustCopy: string;
};

export const campaignThemes: Record<CampaignSlug, CampaignTheme> = {
  "do-it-right-once": {
    slug: "do-it-right-once",
    theme: "heritage",
    background: "#061f34",
    surface: "#0b3554",
    text: "#f7fbff",
    muted: "#c9dce8",
    accent: "#63b7dc",
    accentContrast: "#061f34",
    artworkPath: "/campaigns/do-it-right-once/hero.webp",
    loadingStatement: "Building your roof estimate around the facts.",
    resultHeadline: "Your roof deserves a plan built to last.",
    trustHeadline: "Accountability should outlast installation.",
    trustCopy: "Start with a clear scope, the right materials, and one local team prepared to stand behind the work for the long haul.",
  },
  "weather-report": {
    slug: "weather-report",
    theme: "forecast",
    background: "#082e49",
    surface: "#0c405f",
    text: "#f7fbff",
    muted: "#c9dce8",
    accent: "#ff9a45",
    accentContrast: "#102a3d",
    artworkPath: "/campaigns/weather-report/hero.webp",
    loadingStatement: "Checking what New Jersey weather asks of your roof.",
    resultHeadline: "A clearer forecast starts above your home.",
    trustHeadline: "Prepare before the next storm makes the decision.",
    trustCopy: "Understand the condition, exposure, and recommended scope now, with a New Jersey roofing team that gives you a straight answer.",
  },
  "seasonal-shield": {
    slug: "seasonal-shield",
    theme: "shield",
    background: "#07351f",
    surface: "#0b4b2d",
    text: "#f7fbff",
    muted: "#cce6d6",
    accent: "#90d76f",
    accentContrast: "#07351f",
    artworkPath: "/campaigns/seasonal-shield/hero.webp",
    loadingStatement: "Measuring the protection above your home.",
    resultHeadline: "Protection begins with knowing the full scope.",
    trustHeadline: "One roof. One team accountable for the outcome.",
    trustCopy: "A dependable roof protects the life inside it through every season. We make the plan clear and remain responsible after cleanup.",
  },
  "for-every-season": {
    slug: "for-every-season",
    theme: "seasons",
    background: "#073754",
    surface: "#0d4b6a",
    text: "#f7fbff",
    muted: "#c9e1eb",
    accent: "#7bcb28",
    accentContrast: "#073754",
    artworkPath: "/campaigns/for-every-season/hero.webp",
    loadingStatement: "Preparing a roof estimate built for every season.",
    resultHeadline: "Confidence for every New Jersey season.",
    trustHeadline: "Choose the local team built for lasting trust.",
    trustCopy: "Get a clear plan from one New Jersey company that installs the work and stands behind it for the years ahead.",
  },
};

export const neutralCampaignTheme: CampaignTheme = {
  slug: "all-season",
  theme: "neutral",
  background: "#0f2a4a",
  surface: "#173a60",
  text: "#fffdf7",
  muted: "#d6dee8",
  accent: "#ffda00",
  accentContrast: "#0f2a4a",
  artworkPath: null,
  loadingStatement: "Preparing a clear first look at your roof.",
  resultHeadline: "Your roof estimate is ready.",
  trustHeadline: "Local roofing experience. One accountable team.",
  trustCopy: "All Season gives New Jersey homeowners a clear scope, careful installation, and one company to call after the work is complete.",
};

export function resolveCampaignTheme(campaign: string | null | undefined): CampaignTheme {
  return campaignSlugs.includes(campaign as CampaignSlug)
    ? campaignThemes[campaign as CampaignSlug]
    : neutralCampaignTheme;
}

export function campaignThemeCssVariables(theme: CampaignTheme): Record<string, string> {
  return {
    "--estimate-bg": theme.background,
    "--estimate-surface": theme.surface,
    "--estimate-text": theme.text,
    "--estimate-muted": theme.muted,
    "--estimate-accent": theme.accent,
    "--estimate-accent-contrast": theme.accentContrast,
  };
}
