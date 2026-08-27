export const campaignSlugs = [
  "weather-report",
  "seasonal-shield",
  "for-every-season",
] as const;

export type CampaignSlug = (typeof campaignSlugs)[number];

export type CampaignDefinition = {
  slug: CampaignSlug;
  entryPoint: `campaign:${CampaignSlug}`;
  presentationKey: CampaignSlug;
  theme: "forecast" | "shield" | "seasons";
  name: string;
  kicker: string;
  headline: string;
  headlineAccent: string;
  intro: string;
  bridgeHeadline: string;
  bridgeAccents: string[];
  bridgeCopy: string;
  image: string;
  imageAlt: string;
  formTitle: string;
  formIntro: string;
  submitLabel: string;
  proof: string;
  warranty: string;
  proofItems: Array<{value: string; label: string}>;
  sectionEyebrow: string;
  sectionTitle: string;
  sectionCopy: string;
};

export const campaigns: Record<CampaignSlug, CampaignDefinition> = {
  "weather-report": {
    slug: "weather-report",
    entryPoint: "campaign:weather-report",
    presentationKey: "weather-report",
    theme: "forecast",
    name: "Weather Report",
    kicker: "Your roof has a rough week ahead",
    headline: "Your home gets",
    headlineAccent: "no days off.",
    intro: "Get a clear, no-pressure first look from a local roofing team that understands what New Jersey weather can do to a home.",
    bridgeHeadline: "Be storm ready before the weather decides for you.",
    bridgeAccents: ["storm", "ready"],
    bridgeCopy: "Start with a New Jersey team that knows local roofs and gives you a straight answer.",
    image: "/campaigns/weather-report/hero.webp",
    imageAlt: "All Season seven day New Jersey roof weather campaign",
    formTitle: "Let’s check your roof",
    formIntro: "Share the address. We will take a first look and help you understand the next step.",
    submitLabel: "Get my roof estimate",
    proof: "Built for New Jersey weather",
    warranty: "Long-term workmanship coverage",
    proofItems: [
      {value: "NJ", label: "local roofing experience"},
      {value: "Whole", label: "roof inspection"},
      {value: "Clear", label: "scope before work begins"},
    ],
    sectionEyebrow: "Weather-ready by design",
    sectionTitle: "A clear answer before a small concern becomes a big one.",
    sectionCopy: "We look at the whole roof, explain what we see in plain language, and recommend only the work your home actually needs.",
  },
  "seasonal-shield": {
    slug: "seasonal-shield",
    entryPoint: "campaign:seasonal-shield",
    presentationKey: "seasonal-shield",
    theme: "shield",
    name: "Seasonal Shield",
    kicker: "Protection above everything",
    headline: "The roof above",
    headlineAccent: "everything that matters.",
    intro: "Protect your home with a clear roof plan, dependable local workmanship, and one New Jersey company accountable for the result.",
    bridgeHeadline: "Protect your home with full accountability.",
    bridgeAccents: ["protect", "with", "accountability"],
    bridgeCopy: "Start with a local team, a clear scope, and coverage built for the years ahead.",
    image: "/campaigns/seasonal-shield/hero.webp",
    imageAlt: "A New Jersey neighborhood protected by the All Season roof shield",
    formTitle: "Let’s protect the right home",
    formIntro: "Share the address. We will prepare a first look and answer the questions that matter.",
    submitLabel: "See my roof estimate",
    proof: "Protection for every season",
    warranty: "Lifetime warranty",
    proofItems: [
      {value: "Roof-first", label: "recommendations"},
      {value: "Licensed", label: "New Jersey team"},
      {value: "One", label: "company to call"},
    ],
    sectionEyebrow: "Protection is a system",
    sectionTitle: "A roof protects more than a house.",
    sectionCopy: "It protects the people and life inside it. That is why we explain the work clearly, install it carefully, and stay accountable long after cleanup.",
  },
  "for-every-season": {
    slug: "for-every-season",
    entryPoint: "campaign:for-every-season",
    presentationKey: "for-every-season",
    theme: "seasons",
    name: "For Every Season",
    kicker: "New Jersey roofing, year after year",
    headline: "One roof.",
    headlineAccent: "A lifetime of confidence.",
    intro: "Choose a roof plan built for New Jersey seasons and a local company prepared to stand behind the work for years to come.",
    bridgeHeadline: "Choose the roof company built for lasting trust.",
    bridgeAccents: ["choose", "for", "trust"],
    bridgeCopy: "Get a clear plan from one local team that installs the work and stands behind it.",
    image: "/campaigns/for-every-season/hero.webp",
    imageAlt: "A New Jersey home shown through spring summer fall and winter",
    formTitle: "Let’s start with your home",
    formIntro: "Share the address. We will prepare a first look with no pressure and no guesswork.",
    submitLabel: "Get my roof estimate",
    proof: "20+ years in business",
    warranty: "Unbeatable warranty coverage",
    proofItems: [
      {value: "4", label: "seasons planned for"},
      {value: "20+", label: "years serving homeowners"},
      {value: "1", label: "accountable local team"},
    ],
    sectionEyebrow: "The All Season promise",
    sectionTitle: "Confidence starts with knowing who stands behind the work.",
    sectionCopy: "We make the condition, options, materials, price, and warranty clear before work begins. Then our own team carries the project through completion.",
  },
};

export function isCampaignSlug(value: string): value is CampaignSlug {
  return campaignSlugs.includes(value as CampaignSlug);
}

export function getCampaign(value: string) {
  return isCampaignSlug(value) ? campaigns[value] : undefined;
}

function formValue(form: FormData, name: string) {
  return String(form.get(name) ?? "").trim();
}

export function buildCampaignSubmission({
  campaign,
  submissionId,
  form,
  selectedAddress,
  googlePlaceId,
  search,
}: {
  campaign: CampaignSlug;
  submissionId: string;
  form: FormData;
  selectedAddress: string;
  googlePlaceId: string;
  search: string;
}) {
  const params = new URLSearchParams(search);
  const source = campaigns[campaign];
  const attribution = Object.fromEntries(
    ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "fbclid"]
      .map((key) => [key, params.get(key)]),
  );
  const base = {
    submission_id: submissionId,
    campaign,
    entry_point: source.entryPoint,
    presentation_key: source.presentationKey,
    name: formValue(form, "name"),
    email: formValue(form, "email"),
    phone: formValue(form, "phone"),
    consent_to_contact: true,
    consent_to_process_property: true,
    ...attribution,
  };
  if (googlePlaceId && selectedAddress) {
    return {
      ...base,
      address: selectedAddress,
      google_place_id: googlePlaceId,
    };
  }

  const addressLine1 = formValue(form, "address_line_1");
  const addressLine2 = formValue(form, "address_line_2");
  const city = formValue(form, "city");
  const postalCode = formValue(form, "postal_code");
  return {
    ...base,
    address: [addressLine1, addressLine2, city, `NJ ${postalCode}`].filter(Boolean).join(", "),
    google_place_id: null,
    address_line_1: addressLine1,
    address_line_2: addressLine2 || null,
    city,
    state: "NJ",
    postal_code: postalCode,
  };
}
