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

export function EstimateWaitExperience({
  brand,
  manualReview = false,
}: {
  brand: Brand;
  manualReview?: boolean;
}) {
  const [panel, setPanel] = useState(0);

  useEffect(() => {
    const interval = window.setInterval(
      () => setPanel((current) => (current + 1) % 2),
      6_500,
    );
    return () => window.clearInterval(interval);
  }, []);

  return (
    <div className="mt-auto pt-10">
      <div className="grid grid-cols-[1rem_1fr] gap-x-4 gap-y-5 text-sm">
        <span className="mt-0.5 grid size-4 place-items-center rounded-full bg-cyan-700 text-[10px] font-bold text-white dark:bg-cyan-300 dark:text-slate-950">1</span>
        <div>
          <p className="font-semibold">Request secured</p>
          <p className="mt-1 text-slate-500 dark:text-slate-400">Your details and permissions are saved.</p>
        </div>
        <span className="estimate-status-pulse mt-0.5 size-4 rounded-full border-4 border-cyan-100 bg-cyan-700 dark:border-cyan-900 dark:bg-cyan-300" />
        <div>
          <p className="font-semibold">{manualReview ? "Property review" : "Roof measurement"}</p>
          <p className="mt-1 text-slate-500 dark:text-slate-400">
            {manualReview ? "A roofing professional is checking the building match." : "Google is calculating the roof surface."}
          </p>
        </div>
        <span className="mt-0.5 grid size-4 place-items-center rounded-full bg-slate-200 text-[10px] font-bold text-slate-600 dark:bg-slate-700 dark:text-slate-300">3</span>
        <div>
          <p className="font-semibold text-slate-500 dark:text-slate-400">Range and follow-up</p>
          <p className="mt-1 text-slate-500 dark:text-slate-400">The result is sent by text and email.</p>
        </div>
      </div>

      <div key={panel} className="estimate-reveal mt-8 rounded-2xl bg-slate-100 p-5 dark:bg-slate-800/70">
        {panel === 0 ? (
          <figure>
            <blockquote className="line-clamp-3 text-base font-medium leading-7 text-slate-800 dark:text-slate-100">
              “{brand.testimonial.quote}”
            </blockquote>
            <figcaption className="mt-3 text-xs text-slate-500 dark:text-slate-400">
              {brand.testimonial.author}, {brand.testimonial.source}
            </figcaption>
          </figure>
        ) : (
          <div>
            <p className="text-base font-semibold text-slate-800 dark:text-slate-100">
              {brand.googleRating} stars from {brand.googleReviewCount} Google reviews
            </p>
            <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300">
              {brand.name} serves homeowners across New Jersey with a team you can reach directly.
            </p>
            <a
              href={brand.googleListingUrl}
              target="_blank"
              rel="noreferrer"
              className="mt-3 inline-block text-sm font-semibold text-cyan-700 underline decoration-cyan-700/30 underline-offset-4 dark:text-cyan-300"
            >
              Read customer reviews
            </a>
          </div>
        )}
      </div>

      <div className="mt-4 flex gap-2" aria-label={`Trust story ${panel + 1} of 2`}>
        {[0, 1].map((item) => (
          <button
            key={item}
            type="button"
            aria-label={`Show trust story ${item + 1}`}
            onClick={() => setPanel(item)}
            className={`h-1.5 rounded-full transition-all ${
              item === panel
                ? "w-8 bg-cyan-700 dark:bg-cyan-300"
                : "w-4 bg-slate-300 dark:bg-slate-700"
            }`}
          />
        ))}
      </div>
    </div>
  );
}
