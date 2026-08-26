"use client";

import {useState} from "react";
import {
  getRoofAssessmentContext,
  type RoofAssessmentCampaignSlug,
} from "@/config/roof-assessment";
import {
  calculateRoofAssessment,
  roofAssessmentResponsesSchema,
  type RoofAssessmentRecommendation,
} from "@/domain/roof-assessment";
import {AssessmentExperience} from "../[token]/assessment-experience";
import {AssessmentQuestionnaire} from "../[token]/assessment-questionnaire";
import {getAssessmentResultCopy} from "../[token]/public-estimate-flow";

const campaigns: Array<{slug: RoofAssessmentCampaignSlug; label: string}> = [
  {slug: "for-every-season", label: "Main website"},
  {slug: "do-it-right-once", label: "Do It Right Once"},
  {slug: "weather-report", label: "Weather Report"},
  {slug: "seasonal-shield", label: "Seasonal Shield"},
];

export function AssessmentSandbox() {
  const [campaign, setCampaign] = useState<RoofAssessmentCampaignSlug>("for-every-season");
  const [run, setRun] = useState(0);
  const [recommendation, setRecommendation] = useState<RoofAssessmentRecommendation | null>(null);
  const context = getRoofAssessmentContext(campaign);
  const imageUrl = campaign === "for-every-season" || campaign === "do-it-right-once"
    ? "/campaigns/every-season.jpg"
    : "/campaigns/roof-above.jpg";

  function restart(nextCampaign = campaign) {
    setCampaign(nextCampaign);
    setRecommendation(null);
    setRun((value) => value + 1);
  }

  if (recommendation) {
    const copy = getAssessmentResultCopy(recommendation);
    return (
      <main className="min-h-[100dvh] bg-[#edf2f3] px-5 py-8 text-slate-950 sm:px-8">
        <section className="mx-auto flex min-h-[calc(100dvh-4rem)] max-w-4xl flex-col justify-center">
          <p className="text-xs font-black uppercase tracking-[0.2em] text-cyan-700">{copy.eyebrow}</p>
          <h1 className="mt-5 max-w-3xl text-5xl font-semibold tracking-[-0.055em] sm:text-7xl">{copy.headline}</h1>
          <p className="mt-6 max-w-2xl text-lg leading-8 text-slate-600">{copy.body}</p>
          <div className="mt-10 flex flex-wrap gap-3">
            <button type="button" className="rounded-xl bg-slate-950 px-6 py-4 text-sm font-black text-white" onClick={() => restart()}>{copy.cta}</button>
            <button type="button" className="rounded-xl border border-slate-300 bg-white px-6 py-4 text-sm font-black" onClick={() => restart()}>Replay flow</button>
          </div>
        </section>
      </main>
    );
  }

  return (
    <div>
      <nav className="fixed inset-x-0 bottom-4 z-50 mx-auto flex w-fit max-w-[calc(100%-2rem)] gap-1 overflow-x-auto rounded-full border border-slate-300 bg-white/95 p-1.5 shadow-xl backdrop-blur" aria-label="Assessment preview campaign">
        {campaigns.map((item) => (
          <button
            key={item.slug}
            type="button"
            aria-pressed={campaign === item.slug}
            onClick={() => restart(item.slug)}
            className="whitespace-nowrap rounded-full px-3 py-2 text-xs font-bold text-slate-600 aria-pressed:bg-slate-950 aria-pressed:text-white"
          >
            {item.label}
          </button>
        ))}
      </nav>
      <AssessmentExperience
        key={`${campaign}-${run}`}
        preview
        token="11111111-1111-4111-8111-111111111111"
        address="18 Harbor View Drive, Red Bank, NJ 07701"
        imageUrl={imageUrl}
        context={context}
        initialPropertyRevealed={false}
        initialStep={0}
      >
        <AssessmentQuestionnaire
          preview
          token="11111111-1111-4111-8111-111111111111"
          initialStep={0}
          initialResponses={{}}
          onPreviewComplete={(responses) => {
            const parsed = roofAssessmentResponsesSchema.safeParse(responses);
            if (parsed.success) setRecommendation(calculateRoofAssessment(parsed.data).recommendation);
          }}
        />
      </AssessmentExperience>
    </div>
  );
}
