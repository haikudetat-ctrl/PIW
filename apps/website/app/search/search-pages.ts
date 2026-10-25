import {companyFacts, examplePriceRange, formatUsd} from "../../lib/company-facts";
import {searchPageSlugs, type SearchPageSlug} from "../../lib/landing-slugs";

/**
 * Google Search landing pages, one per ad group intent. Copy follows the
 * AllSeason voice brief: a calm local roofing professional, plain English,
 * short sentences, no hype, no urgency, no unverified claims. Every fact comes
 * from lib/company-facts.ts.
 */

export type SearchFaq = {question: string; answer: string};

export type SearchPageDefinition = {
  slug: SearchPageSlug;
  entryPoint: `campaign:${SearchPageSlug}`;
  presentationKey: SearchPageSlug;
  /** Google Ads ad group this page serves; for the runbook and reporting. */
  adGroup: string;
  metaTitle: string;
  metaDescription: string;
  eyebrow: string;
  headline: string;
  intro: string;
  formTitle: string;
  formIntro: string;
  priceHeadline: string;
  priceIntro: string;
  faqs: SearchFaq[];
  closingHeadline: string;
  closingCopy: string;
};

export const SEARCH_CTA_LABEL = "Get My Free Roof Estimate";
export const EXAMPLE_ROOF_SQUARES = 25;

const {low, high} = companyFacts.pricePerSquare;
const perSquare = `${formatUsd(low)} to ${formatUsd(high)} per square`;
const example = examplePriceRange(EXAMPLE_ROOF_SQUARES);
const financing = `${companyFacts.financing.partners.join(" and ")}, ${companyFacts.financing.qualifier}`;

const sharedFaqs: SearchFaq[] = [
  {
    question: "Is the estimate really free?",
    answer: "Yes. The online estimate and the conversation that follows are free, and there is no obligation to move forward.",
  },
  {
    question: "How can you price my roof without coming out?",
    answer: "We measure your roof from aerial imagery and apply our current pricing to that size. A specialist reviews the details with you before anything is final.",
  },
  {
    question: "Do I have to meet with a salesperson at my house?",
    answer: "No. You can review your estimate with a specialist on a video call. If you would rather meet in person, ask and we will set that up.",
  },
  {
    question: "Do you offer financing?",
    answer: `Yes. Financing is available through ${financing}.`,
  },
  {
    question: "Do you handle roof repairs?",
    answer: `Our focus is full roof replacement. If you need a repair, call us at ${companyFacts.phone.display} and we will tell you whether we can help.`,
  },
];

export const searchPages: Record<SearchPageSlug, SearchPageDefinition> = {
  "roof-replacement": {
    slug: "roof-replacement",
    entryPoint: "campaign:roof-replacement",
    presentationKey: "roof-replacement",
    adGroup: "Roof Replacement",
    metaTitle: "Roof Replacement in New Jersey | AllSeason",
    metaDescription: "See your roof measured and priced online, then talk it through with a local New Jersey roofing team. Free estimate, no obligation.",
    eyebrow: "Roof replacement in New Jersey",
    headline: "Replacing your roof? Start with a clear estimate.",
    intro: "Enter your address and see your roof measured from aerial imagery, with replacement pricing for your home. Then talk it through with a local team, by video or in person.",
    formTitle: "Get your free roof estimate",
    formIntro: "Start with the address. You will see your roof and your price on the next screen.",
    priceHeadline: "What a roof replacement costs",
    priceIntro: `Our current pricing for a full roof replacement is ${perSquare}. A square is 100 square feet of roof surface.`,
    faqs: [
      {
        question: "Where do you work?",
        answer: `We replace roofs for homeowners across ${companyFacts.serviceArea}.`,
      },
      ...sharedFaqs,
    ],
    closingHeadline: "Ready when you are.",
    closingCopy: "Your estimate takes a few minutes. There is no obligation, and you choose whether we meet by video or in person.",
  },
  "roof-replacement-cost": {
    slug: "roof-replacement-cost",
    entryPoint: "campaign:roof-replacement-cost",
    presentationKey: "roof-replacement-cost",
    adGroup: "Roof Cost / Estimate",
    metaTitle: "Roof Replacement Cost in New Jersey | AllSeason",
    metaDescription: `Roof replacement pricing from ${perSquare}. Enter your address to see your roof measured and priced for your home.`,
    eyebrow: "Roof replacement cost",
    headline: "What will a new roof cost for your home?",
    intro: `Our replacement pricing runs ${perSquare}. Enter your address and we will measure your roof, so you see a number for your home instead of an average.`,
    formTitle: "See your roof replacement price",
    formIntro: "Start with the address. Your measured roof and price come up on the next screen.",
    priceHeadline: "How your price is calculated",
    priceIntro: `We price a full replacement at ${perSquare}. A square is 100 square feet of roof surface, so the size of your roof does most of the work.`,
    faqs: [
      {
        question: "Why a range instead of one price?",
        answer: "Two roofs with the same size can still differ in steepness, layers to remove, and details like chimneys and skylights. Your estimate uses your roof's measured size, and a specialist confirms the rest with you.",
      },
      ...sharedFaqs,
    ],
    closingHeadline: "See the number for your roof.",
    closingCopy: "It takes a few minutes and there is no obligation. You decide what happens next.",
  },
  "roofing-contractor": {
    slug: "roofing-contractor",
    entryPoint: "campaign:roofing-contractor",
    presentationKey: "roofing-contractor",
    adGroup: "Roofers Near Me",
    metaTitle: "Roofing Contractor in New Jersey | AllSeason",
    metaDescription: "A local New Jersey roofing team with 20+ years of experience. Get a free roof replacement estimate online, then talk by video or in person.",
    eyebrow: "Local roofing contractor",
    headline: "A New Jersey roofing team that shows you the numbers first.",
    intro: `${companyFacts.experience.headline} ${companyFacts.experience.detail}. Get a free estimate online, then decide how you want to talk: a video call or a visit.`,
    formTitle: "Get your free roof estimate",
    formIntro: "Start with the address. You will see your roof and your price on the next screen.",
    priceHeadline: "Straight answers on price",
    priceIntro: `We price a full replacement at ${perSquare}. A square is 100 square feet of roof surface.`,
    faqs: [
      {
        question: "Where do you work?",
        answer: `We replace roofs for homeowners across ${companyFacts.serviceArea}.`,
      },
      ...sharedFaqs,
    ],
    closingHeadline: "Start with an estimate, not a sales pitch.",
    closingCopy: "There is no obligation. You see your price first and choose how you want to talk.",
  },
};

export const priceFactors = [
  "The size and steepness of your roof",
  "How many layers of old roofing come off",
  "The shingle line you choose: your estimate shows Good, Better and Best options",
  "Chimneys, skylights, valleys and other details",
  "Repairs to the wood decking underneath, if any are needed",
] as const;

export const priceExample = {
  squares: example.squares,
  text: `A roof that measures ${example.squares} squares would come to ${example.low} to ${example.high} at that range.`,
};

export const processSteps = [
  {title: "Enter your address", copy: "We find your home and measure the roof from aerial imagery."},
  {title: "See your estimate", copy: "Good, Better and Best options for your roof, priced for its measured size."},
  {title: "Talk it through your way", copy: "Book a video call right from the estimate screen, or ask for an in-person visit."},
] as const;

export function getSearchPage(slug: string): SearchPageDefinition | undefined {
  return (searchPageSlugs as readonly string[]).includes(slug)
    ? searchPages[slug as SearchPageSlug]
    : undefined;
}

/**
 * Ad landing pages stay out of organic search: they duplicate the main site's
 * topics and exist to match ad intent, so they are noindex and unfollowed.
 */
export function searchPageMetadata(page: SearchPageDefinition) {
  return {
    title: page.metaTitle,
    description: page.metaDescription,
    robots: {index: false, follow: false},
  };
}
