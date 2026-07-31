"use client";

import { useEffect, useState } from "react";

type Brand = {
  name: string;
  phoneDisplay: string;
  phoneHref: string;
  websiteUrl: string;
  googleListingUrl: string;
  googleRating: string;
  googleReviewCount: number;
  googleSnapshotDate: string;
  testimonial: { quote: string; author: string; source: string };
};

export function EstimateWaitExperience({ brand, manualReview = false }: { brand: Brand; manualReview?: boolean }) {
  const [panel, setPanel] = useState(0);
  useEffect(() => {
    const interval = window.setInterval(() => setPanel((current) => (current + 1) % 3), 7_000);
    return () => window.clearInterval(interval);
  }, []);

  const panels = [
    <div key="process" className="grid gap-4 text-left">
      <p className="text-xs font-bold tracking-[0.16em] text-accent uppercase">What’s happening now</p>
      <ol className="grid gap-3 text-sm text-ink-muted">
        <li className="flex gap-3"><span className="grid size-6 shrink-0 place-items-center rounded-full bg-success-bg font-bold text-success">✓</span><span>Your request and contact permissions are saved.</span></li>
        <li className="flex gap-3"><span className="grid size-6 shrink-0 place-items-center rounded-full bg-info-bg font-bold text-info">2</span><span>{manualReview ? "A roofing professional is checking the address and building match." : "Google is matching the building and measuring its roof planes."}</span></li>
        <li className="flex gap-3"><span className="grid size-6 shrink-0 place-items-center rounded-full bg-surface-muted font-bold text-ink-subtle">3</span><span>We apply the New Jersey price range and send the result by text and email.</span></li>
      </ol>
    </div>,
    <div key="trust" className="grid gap-4 text-left">
      <p className="text-xs font-bold tracking-[0.16em] text-accent uppercase">A local team you can reach</p>
      <p className="text-lg font-semibold text-ink">{brand.name}</p>
      <p className="text-sm leading-6 text-ink-muted">Google lists the Galloway-based company at {brand.googleRating} stars from {brand.googleReviewCount} reviews.</p>
      <div className="flex flex-wrap gap-3">
        <a href={brand.phoneHref} className="rounded-lg bg-accent px-4 py-2.5 text-sm font-bold text-white">Call {brand.phoneDisplay}</a>
        <a href={brand.websiteUrl} target="_blank" rel="noreferrer" className="rounded-lg border border-border-strong px-4 py-2.5 text-sm font-bold text-accent">Visit company website</a>
      </div>
      <a href={brand.googleListingUrl} target="_blank" rel="noreferrer" className="text-xs text-ink-subtle underline underline-offset-4">Google rating snapshot viewed {brand.googleSnapshotDate}</a>
    </div>,
    <figure key="review" className="grid gap-4 text-left">
      <p className="text-xs font-bold tracking-[0.16em] text-accent uppercase">Homeowner feedback</p>
      <blockquote className="text-xl font-semibold leading-8 text-ink">“{brand.testimonial.quote}”</blockquote>
      <figcaption className="text-sm text-ink-muted">{brand.testimonial.author} · {brand.testimonial.source}</figcaption>
      <a href={brand.googleListingUrl} target="_blank" rel="noreferrer" className="text-xs text-ink-subtle underline underline-offset-4">Read reviews on Google</a>
    </figure>,
  ];

  return (
    <div className="mt-8 rounded-xl border border-border bg-surface-muted p-5 sm:p-6">
      <div className="min-h-52">{panels[panel]}</div>
      <div className="mt-5 flex justify-center gap-2" aria-label={`Trust story ${panel + 1} of 3`}>
        {[0, 1, 2].map((item) => <button key={item} type="button" aria-label={`Show story ${item + 1}`} onClick={() => setPanel(item)} className={`size-2.5 rounded-full ${item === panel ? "bg-accent" : "bg-border-strong"}`} />)}
      </div>
    </div>
  );
}
