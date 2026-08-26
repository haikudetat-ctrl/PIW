"use client";

import type { CSSProperties } from "react";
import { useEffect, useState } from "react";
import {
  campaignThemeCssVariables,
  type CampaignTheme,
} from "@/../shared/all-season-campaign-themes";
import { roofEstimateBrand } from "@/config/roof-estimate-brand";

export function EstimateWaitExperience({
  theme,
  manualReview = false,
}: {
  theme: CampaignTheme;
  manualReview?: boolean;
}) {
  const [panel, setPanel] = useState(0);

  useEffect(() => {
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    const interval = window.setInterval(
      () => setPanel((current) => (current + 1) % 2),
      6_500,
    );
    return () => window.clearInterval(interval);
  }, []);

  return (
    <div
      className="estimate-wait"
      data-estimate-theme={theme.theme}
      style={campaignThemeCssVariables(theme) as CSSProperties}
    >
      <ol className="estimate-stages" aria-label="Estimate progress">
        <li
          className={`estimate-stage ${
            manualReview ? "estimate-stage--active" : "estimate-stage--complete"
          }`}
          aria-current={manualReview ? "step" : undefined}
        >
          <span className="estimate-stage-marker" aria-hidden="true">
            1
          </span>
          <div>
            <p className="estimate-stage-title">Confirming the property</p>
            <p className="estimate-stage-copy">
              {manualReview
                ? "A roofing professional is checking the property match before we prepare your estimate."
                : "Your request is secured and matched to the submitted address."}
            </p>
            {manualReview ? (
              <a className="estimate-stage-call" href={roofEstimateBrand.phoneHref}>
                Call {roofEstimateBrand.phoneDisplay}
              </a>
            ) : null}
          </div>
        </li>
        <li
          className={`estimate-stage ${
            manualReview ? "estimate-stage--pending" : "estimate-stage--active"
          }`}
          aria-current={manualReview ? undefined : "step"}
        >
          <span className="estimate-stage-marker estimate-status-pulse" aria-hidden="true">
            2
          </span>
          <div>
            <p className="estimate-stage-title">Measuring the roof</p>
            <p className="estimate-stage-copy">
              {manualReview
                ? "Measurement continues after the property match is confirmed."
                : "The visible roof surface and dimensions are being evaluated."}
            </p>
          </div>
        </li>
        <li className="estimate-stage estimate-stage--pending">
          <span className="estimate-stage-marker" aria-hidden="true">
            3
          </span>
          <div>
            <p className="estimate-stage-title">Preparing the estimate</p>
            <p className="estimate-stage-copy">Your first range and next steps will appear here.</p>
          </div>
        </li>
      </ol>

      <div className="estimate-trust-rotation">
        <figure
          className={`estimate-trust-panel ${
            panel === 0 ? "estimate-trust-panel--active estimate-reveal" : ""
          }`}
          aria-hidden={panel !== 0}
        >
          <blockquote>“{roofEstimateBrand.testimonial.quote}”</blockquote>
          <figcaption>
            {roofEstimateBrand.testimonial.author}, {roofEstimateBrand.testimonial.source}
          </figcaption>
        </figure>
        <div
          className={`estimate-trust-panel ${
            panel === 1 ? "estimate-trust-panel--active estimate-reveal" : ""
          }`}
          aria-hidden={panel !== 1}
        >
          <p className="estimate-trust-heading">
            {roofEstimateBrand.googleRating} stars from {roofEstimateBrand.googleReviewCount} Google reviews
          </p>
          <p>
            {roofEstimateBrand.name} serves homeowners across New Jersey with a team you can reach directly.
          </p>
          <a
            href={roofEstimateBrand.googleListingUrl}
            target="_blank"
            rel="noreferrer"
          >
            Read customer reviews
          </a>
        </div>
      </div>

      <div className="estimate-trust-controls" aria-label={`Trust story ${panel + 1} of 2`}>
        {[0, 1].map((item) => (
          <button
            key={item}
            type="button"
            aria-label={`Show trust story ${item + 1}`}
            aria-pressed={item === panel}
            onClick={() => setPanel(item)}
            className={
              item === panel
                ? "estimate-trust-control estimate-trust-control--active"
                : "estimate-trust-control"
            }
          />
        ))}
      </div>
    </div>
  );
}
