"use client";

import { useState, useTransition } from "react";
import { inputClasses, primaryButtonClasses, secondaryButtonClasses } from "@/components/ui/form";
import { createLeadBookingLink } from "../../appointments/actions";

export function BookingLinkButton({ leadId }: { leadId: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [pending, startTransition] = useTransition();

  function create() {
    setMessage(null);
    startTransition(async () => {
      try {
        const result = await createLeadBookingLink(leadId);
        if (result.ok) {
          setUrl(result.url);
          setExpiresAt(result.expiresAt);
        } else {
          setMessage(result.reason);
        }
      } catch {
        setMessage("Couldn't create the link. Try again.");
      }
    });
  }

  async function copy() {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setMessage("Copy didn't work. Select the link and copy it manually.");
    }
  }

  if (!url) {
    return (
      <div>
        <button type="button" onClick={create} disabled={pending} className={primaryButtonClasses}>
          {pending ? "Creating link…" : "Get booking link"}
        </button>
        {message ? <p role="alert" className="mt-2 text-[13px] text-danger">{message}</p> : null}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <label className="sr-only" htmlFor={`booking-link-${leadId}`}>Booking link</label>
      <input id={`booking-link-${leadId}`} readOnly value={url} className={`${inputClasses} mt-0 font-mono text-xs`} onFocus={(event) => event.currentTarget.select()} />
      <div className="flex items-center gap-2">
        <button type="button" onClick={copy} className={secondaryButtonClasses}>{copied ? "Copied" : "Copy link"}</button>
        {expiresAt ? (
          <span className="text-xs text-ink-subtle">
            Valid until {new Date(expiresAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}, and through their meeting once booked.
          </span>
        ) : null}
      </div>
      {message ? <p role="alert" className="text-[13px] text-danger">{message}</p> : null}
    </div>
  );
}
