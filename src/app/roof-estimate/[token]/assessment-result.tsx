"use client";
/* eslint-disable @next/next/no-img-element */

import {useEffect, useRef, useState, type FormEvent} from "react";
import Link from "next/link";
import {useGSAP} from "@gsap/react";
import gsap from "gsap";
import type {RoofAssessmentContext} from "@/config/roof-assessment";
import type {CalculationState, RoofAssessmentRecommendation, RoofAssessmentResponses} from "@/domain/roof-assessment";
import type {RoofPricingAdjustmentDisclosure} from "@/domain/roof-pricing";
import {consultationApiSuccessSchema, type ConsultationCallWindow, type ConsultationContactMethod} from "@/modules/roof-assessment/consultation-preference";
import {getAssessmentResultCopy, getAssessmentResultCta, getAssessmentResultRange} from "./public-estimate-flow";
import "./assessment.css";

const money=new Intl.NumberFormat("en-US",{style:"currency",currency:"USD",maximumFractionDigits:0});
const callWindows: Array<{value:ConsultationCallWindow;label:string}>=[
  {value:"asap",label:"As soon as possible"},{value:"morning",label:"Morning · 8–11 ET"},
  {value:"midday",label:"Midday · 11–2 ET"},{value:"afternoon",label:"Afternoon · 2–5 ET"},
  {value:"evening",label:"Evening · 5–7 ET"},
];

function formatAdjustmentRange(adjustment:RoofPricingAdjustmentDisclosure){
  const values=adjustment.lowValue===adjustment.highValue
    ? `${adjustment.lowValue}`
    : `${adjustment.lowValue}–${adjustment.highValue}`;
  if(adjustment.calculationKind==="percentage")return `+${values}%`;
  const dollars=adjustment.lowValue===adjustment.highValue
    ? money.format(adjustment.lowValue)
    : `${money.format(adjustment.lowValue)}–${money.format(adjustment.highValue)}`;
  if(adjustment.calculationKind==="per_square")return `${dollars} / roofing square`;
  if(adjustment.calculationKind==="per_unit")return `${dollars} / unit`;
  return dollars;
}

function getProjectOutlook(responses:RoofAssessmentResponses,recommendation:RoofAssessmentRecommendation){
  const urgent=responses.reason==="active_leak"||responses.conditionSignals.some(signal=>signal==="active_leak"||signal==="sagging");
  const timing=urgent||responses.timeline==="asap"?"Prompt professional review":responses.timeline==="within_month"?"Plan within the next month":responses.timeline==="this_season"?"Plan within this season":"Monitor and plan deliberately";
  const direction=recommendation==="replacement_may_make_sense"?"Compare replacement pricing with the cost of continued repairs.":recommendation==="professional_inspection"?"Confirm the repairable areas and remaining roof service life.":"Start with targeted maintenance or repair before considering replacement.";
  const levels=responses.complexityFeatures.includes("multiple_levels"); const garage=responses.complexityFeatures.includes("garage");
  const costFactors=levels&&garage?"Multiple roof levels and an attached garage may affect access and material quantities.":levels?"Multiple roof levels may affect access, labor, and material quantities.":garage?"The attached garage may add roof area and transition details to the project.":responses.stories==="three_plus"?"Building height may affect access and labor planning.":"Field conditions, tear-off layers, and decking remain the main unknowns.";
  return {timing,direction,costFactors};
}

export function ConsultationPreferenceForm({token}: {token:string}) {
  const [method,setMethod]=useState<ConsultationContactMethod|null>(null);
  const [window,setWindow]=useState<ConsultationCallWindow|null>(null);
  const [error,setError]=useState(""); const [submitting,setSubmitting]=useState(false);
  const [success,setSuccess]=useState<{contactMethod:ConsultationContactMethod;callWindow:ConsultationCallWindow|null}|null>(null);
  async function submit(event:FormEvent){
    event.preventDefault(); setError("");
    if(!method){setError("Choose how you would like us to follow up.");return;}
    if(method==="call"&&!window){setError("Choose the best Eastern Time window for your call.");return;}
    setSubmitting(true);
    try{
      const response=await fetch(`/api/roof-estimate/${token}/consultation`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({contactMethod:method,callWindow:method==="call"?window:null})});
      if(!response.ok) throw new Error("unavailable");
      const parsed=consultationApiSuccessSchema.safeParse(await response.json());
      if(!parsed.success||parsed.data.contactMethod!==method||parsed.data.callWindow!==(method==="call"?window:null))throw new Error("unavailable");
      setSuccess(parsed.data);
    }catch{setError("We could not save your preference. Please try again.");}finally{setSubmitting(false);}
  }
  if(success){
    const label=callWindows.find(item=>item.value===success.callWindow)?.label.split(" · ")[0].toLowerCase();
    return <div className="assessment-consultation-success" aria-live="polite"><p className="text-sm font-black uppercase tracking-[0.14em] text-emerald-700">Preference saved</p><p className="mt-2 text-lg font-semibold">{success.contactMethod==="call"?`We’ll call during your selected ${label} window.`:success.contactMethod==="text"?"We’ll follow up by text.":"We’ll follow up by email."}</p><p className="mt-2 text-sm text-slate-600">An All Season specialist will have your property assessment ready.</p></div>;
  }
  return <form onSubmit={submit} className="assessment-consultation-form">
    <fieldset><legend className="text-lg font-semibold">How should we follow up?</legend><p className="mt-1 text-sm text-slate-600">Choose one option. We’ll keep the conversation focused on this property.</p>
      <div className="mt-4 grid gap-2 sm:grid-cols-3">{([['call','Call me'],['text','Text me'],['email','Email me']] as const).map(([value,label])=><label key={value} className="assessment-choice"><input type="radio" name="contact-method" value={value} checked={method===value} onChange={()=>{setMethod(value);if(value!=="call")setWindow(null);}}/><span>{label}</span></label>)}</div>
    </fieldset>
    {method==="call"?<fieldset className="mt-5"><legend className="text-sm font-semibold">Best Eastern Time window</legend><div className="mt-3 grid gap-2 sm:grid-cols-2">{callWindows.map(item=><label key={item.value} className="assessment-choice"><input type="radio" name="call-window" value={item.value} checked={window===item.value} onChange={()=>setWindow(item.value)}/><span>{item.label}</span></label>)}</div></fieldset>:null}
    {error?<p role="alert" aria-live="assertive" className="mt-4 text-sm font-semibold text-red-700">{error}</p>:<p aria-live="polite" className="sr-only">{submitting?"Saving your preference":""}</p>}
    <button type="submit" disabled={submitting} className="assessment-primary-action mt-5 w-full px-6 py-4 text-sm font-black text-white disabled:opacity-60">{submitting?"Saving preference…":"Request my consultation"}</button>
  </form>;
}

export function AssessmentResult({token,address,imageUrl,recommendation,responses,calculation,context,onReplay,preview=false}:{token:string;address:string;imageUrl:string;recommendation:RoofAssessmentRecommendation;responses:RoofAssessmentResponses;calculation:CalculationState;context:RoofAssessmentContext;onReplay?:()=>void;preview?:boolean}){
  const copy=getAssessmentResultCopy(recommendation); const outlook=getProjectOutlook(responses,recommendation); const range=getAssessmentResultRange(calculation); const cta=getAssessmentResultCta(recommendation,calculation);
  const packageCalculation=calculation.status==="ready"&&"packages" in calculation?calculation:null;
  const resultRef=useRef<HTMLElement>(null); const recorded=useRef(false); const [consultationOpen,setConsultationOpen]=useState(false);
  useEffect(()=>{if(preview||recorded.current)return;recorded.current=true;void fetch(`/api/roof-estimate/${token}/result-view`,{method:"POST"}).catch(()=>undefined);},[preview,token]);
  useGSAP(()=>{if(!window.matchMedia||window.matchMedia("(prefers-reduced-motion: reduce)").matches)return;gsap.timeline({defaults:{ease:"power3.out"}}).fromTo(".assessment-result-image",{scale:.96,opacity:.58},{scale:1,opacity:1,duration:.9}).fromTo(".assessment-result-copy > *",{y:14,opacity:0},{y:0,opacity:1,duration:.45,stagger:.045},"-=0.58");},{scope:resultRef});
  return <main ref={resultRef} className={`assessment-flow ${context.accentClass} min-h-[100dvh] w-full max-w-full overflow-x-hidden px-4 py-5 text-slate-950 sm:px-7 sm:py-8`}><div className="mx-auto max-w-7xl">
    <header className="assessment-nav flex items-center justify-between border-b pb-5"><div><p className="text-xs font-black tracking-[0.2em]">ALL SEASON</p><p className="mt-1 text-[0.65rem] font-bold uppercase tracking-[0.18em] text-slate-500">{context.kicker}</p></div><span className="text-xs font-bold text-slate-500">Assessment complete</span></header>
    <section className="py-9 sm:py-12"><div className="assessment-result-card grid overflow-hidden border bg-white lg:grid-cols-[minmax(0,0.88fr)_minmax(30rem,1.12fr)]">
      <div className="assessment-result-visual relative min-h-[22rem] bg-[#102f3d] sm:min-h-[30rem] lg:min-h-[44rem]"><img src={imageUrl} alt={`Aerial view of ${address}`} className="assessment-result-image absolute inset-0 size-full object-cover"/><div className="absolute inset-0 bg-gradient-to-t from-slate-950/90 via-slate-950/10 to-transparent"/><div className="absolute inset-x-0 bottom-0 p-6 text-white sm:p-8"><p className="text-lg font-semibold">{address}</p><Link href="/roof-estimate" className="mt-3 inline-flex text-xs font-semibold text-white/70 underline">Not your property? Update the address</Link></div></div>
      <div className="assessment-result-copy p-6 sm:p-9 lg:p-11"><p className="assessment-context-kicker text-xs font-black uppercase tracking-[0.16em]">{copy.eyebrow}</p><h1 className="assessment-display mt-4 text-[clamp(3.2rem,5vw,5.5rem)] leading-[.92]">{context.resultHeadline}</h1><p className="mt-4 max-w-2xl text-base leading-7 text-slate-600">{context.resultIntro}</p><h2 className="mt-7 text-2xl font-semibold tracking-[-.025em]">{copy.headline}</h2><p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">{copy.body}</p>
        {packageCalculation?<section className="mt-8" aria-live="polite">
          {recommendation!=="replacement_may_make_sense"?<p className="assessment-package-framing">If replacement is confirmed after inspection</p>:null}
          <div className="flex flex-wrap items-end justify-between gap-3"><div><h2 className="text-2xl font-semibold tracking-[-.025em]">Three ways to approach the project</h2><p className="mt-2 text-sm leading-6 text-slate-600">Each option is based on approximately {packageCalculation.roofSquares.toFixed(1)} measured roofing squares.</p></div><p className="text-xs font-bold uppercase tracking-[.14em] text-slate-400">Preliminary planning ranges</p></div>
          <div className="assessment-package-grid mt-6">{packageCalculation.packages.map(item=><article key={item.tierKey} aria-label={item.recommended?"Recommended package":undefined} className={`assessment-package-card ${item.recommended?"assessment-package-card--recommended":""}`}>
            <div className="flex items-center justify-between gap-3"><p className="text-[.68rem] font-black uppercase tracking-[.16em] text-slate-500">{item.tierKey}</p>{item.recommended?<span className="assessment-package-badge">Recommended package</span>:null}</div>
            <h3 className="mt-4 text-xl font-semibold tracking-[-.025em]">{item.customerName}</h3>
            <p className="mt-3 text-[1.7rem] font-semibold leading-none tracking-[-.055em]"><span>{money.format(item.rangeLowCents/100)}</span><span className="mx-1.5 text-base text-slate-400">–</span><span>{money.format(item.rangeHighCents/100)}</span></p>
            <p className="mt-4 text-sm leading-6 text-slate-600">{item.customerDescription}</p>
            <p className="mt-5 border-t border-slate-200 pt-4 text-xs font-bold leading-5 text-slate-700">{item.warrantySummary}</p>
            <ul className="mt-3 space-y-2">{item.differentiators.map(detail=><li key={detail} className="flex gap-2 text-xs leading-5 text-slate-600"><span aria-hidden="true" className="assessment-package-check">✓</span><span>{detail}</span></li>)}</ul>
          </article>)}</div>
          {packageCalculation.adjustments.length>0?<div className="assessment-adjustments mt-6"><div><p className="text-xs font-black uppercase tracking-[.14em] text-slate-500">Field-confirmed adjustments</p><p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">These are not included unless inspection confirms they apply to this property.</p></div><div className="mt-5 divide-y divide-slate-200">{packageCalculation.adjustments.map(item=><div key={item.code} className="assessment-adjustment-row"><div><p className="text-sm font-semibold text-slate-900">{item.label}</p><p className="mt-1 text-xs leading-5 text-slate-500">{item.explanation}</p></div><p className="text-sm font-bold text-slate-800">{formatAdjustmentRange(item)}</p></div>)}</div></div>:null}
        </section>:<div className="assessment-range-panel mt-8 p-6 text-white sm:p-7" aria-live="polite">{range?<><p className="text-sm font-semibold text-white/65">Preliminary project range</p><p className="mt-3 flex flex-wrap items-baseline gap-x-3 text-4xl font-semibold tracking-[-.05em] sm:text-5xl"><span>{money.format(range.lowCents/100)}</span><span className="text-2xl text-white/45">to</span><span>{money.format(range.highCents/100)}</span></p><p className="mt-4 text-xs text-white/60">Based on approximately {range.roofSquares.toFixed(1)} measured roofing squares</p></>:calculation.status==="pending"?<><p className="text-lg font-semibold">Finalizing your property calculation</p><p className="mt-2 text-sm leading-6 text-white/65">Your outlook is ready. A measured range will appear only when Google returns a trustworthy calculation.</p></>:<><p className="text-lg font-semibold">A professional is reviewing the property</p><p className="mt-2 text-sm leading-6 text-white/65">Google did not return a measurement we trust enough to price automatically. We will not invent a range.</p></>}</div>}
        <div className="mt-8 grid gap-7 sm:grid-cols-2"><div><h2 className="text-sm font-semibold text-slate-500">Recommended timing</h2><p className="mt-2 text-xl font-semibold">{outlook.timing}</p></div><div><h2 className="text-sm font-semibold text-slate-500">Likely direction</h2><p className="mt-2 text-sm leading-6 text-slate-700">{outlook.direction}</p></div><div className="sm:col-span-2 sm:border-t sm:border-slate-200 sm:pt-6"><h2 className="text-sm font-semibold text-slate-500">What may shape the project</h2><p className="mt-2 text-sm leading-6 text-slate-700">{outlook.costFactors}</p></div></div>
        {!consultationOpen?<div className="mt-9 flex flex-col gap-3 sm:flex-row"><button type="button" onClick={()=>setConsultationOpen(true)} aria-describedby="assessment-consultation-note" className="assessment-conversion-action px-6 py-4 text-sm font-black text-white">{cta}</button>{onReplay?<button type="button" onClick={onReplay} className="px-5 py-3 text-sm font-bold text-slate-500">Replay assessment</button>:null}</div>:<div className="assessment-consultation-panel mt-9"><p className="assessment-context-kicker text-xs font-black uppercase tracking-[.14em]">Next step</p><h2 className="mt-2 text-2xl font-semibold">Choose how we should continue.</h2><p className="mt-2 text-sm leading-6 text-slate-600">{context.consultationIntro}</p><div className="mt-5"><ConsultationPreferenceForm token={token}/></div></div>}
        <p id="assessment-consultation-note" className="mt-4 text-xs leading-5 text-slate-500">A roofing specialist will review the property details and your priorities before recommending a scope.</p><p className="mt-5 text-xs leading-5 text-slate-500">Preliminary planning guidance only. A field inspection confirms scope, materials, and final pricing.</p>
      </div></div></section></div></main>;
}
