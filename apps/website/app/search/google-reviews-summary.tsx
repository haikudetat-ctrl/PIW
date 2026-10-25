"use client";

import {useEffect, useState} from "react";

type ReviewsPayload = {
  businessName: string;
  rating: number;
  reviewCount: number;
  googleMapsUri: string;
  reviews: Array<{
    author: string;
    authorUri: string;
    rating: number;
    text: string;
    relativeTime?: string;
    reviewUri: string;
  }>;
};

function isPayload(value: unknown): value is ReviewsPayload {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<ReviewsPayload>;
  return typeof candidate.rating === "number"
    && typeof candidate.reviewCount === "number"
    && typeof candidate.googleMapsUri === "string"
    && Array.isArray(candidate.reviews);
}

function useGoogleReviews() {
  const [payload, setPayload] = useState<ReviewsPayload | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/google-reviews", {signal: controller.signal, cache: "no-store"})
      .then((response) => response.ok ? response.json() : null)
      .then((body: unknown) => { if (isPayload(body) && body.reviewCount > 0) setPayload(body); })
      .catch(() => undefined);
    return () => controller.abort();
  }, []);
  return payload;
}

function excerpt(text: string, max = 240) {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  return `${cut.slice(0, cut.lastIndexOf(" ") > 0 ? cut.lastIndexOf(" ") : max)}…`;
}

/**
 * Live Google rating and recent reviews. Renders nothing until Google answers,
 * so the page never shows a number or a quote we did not fetch.
 */
export function GoogleRatingBadge() {
  const payload = useGoogleReviews();
  if (!payload) return null;
  return (
    <a className="sl-rating" href={payload.googleMapsUri} target="_blank" rel="noopener noreferrer">
      <strong>{payload.rating.toFixed(1)}</strong>
      <span aria-hidden="true">★★★★★</span>
      <small>{payload.reviewCount.toLocaleString("en-US")} Google reviews</small>
    </a>
  );
}

export function GoogleReviewsList({limit = 3}: {limit?: number}) {
  const payload = useGoogleReviews();
  if (!payload || payload.reviews.length === 0) return null;
  return (
    <div className="sl-reviews" aria-label="Recent Google reviews">
      <div className="sl-reviews-head">
        <p className="sl-eyebrow">What homeowners say</p>
        <a href={payload.googleMapsUri} target="_blank" rel="noopener noreferrer">
          {payload.rating.toFixed(1)} from {payload.reviewCount.toLocaleString("en-US")} reviews on Google
        </a>
      </div>
      <ul>
        {payload.reviews.slice(0, limit).map((review) => (
          <li key={review.reviewUri}>
            <p aria-label={`${review.rating} out of 5 stars`} className="sl-review-stars">{"★".repeat(review.rating)}</p>
            <blockquote>{excerpt(review.text)}</blockquote>
            <p className="sl-review-meta">
              <a href={review.authorUri} target="_blank" rel="noopener noreferrer">{review.author}</a>
              {review.relativeTime ? <span> · {review.relativeTime}</span> : null}
            </p>
          </li>
        ))}
      </ul>
      <p className="sl-review-source">Reviews from Google</p>
    </div>
  );
}
