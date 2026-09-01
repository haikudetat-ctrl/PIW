"use client";

import {FormEvent, useState} from "react";
import {useMetaPixel, type MetaBrowserEventEnvelope} from "./meta-pixel-provider";

export function LeadWebhookForm() {
  const {trackConversion} = useMetaPixel();
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    setStatus("sending");

    const form = new FormData(formElement);
    const response = await fetch("/api/intake", {
      method: "POST",
      headers: {"content-type": "application/json"},
      body: JSON.stringify({
        name: form.get("name"),
        email: form.get("email"),
        phone: form.get("phone"),
        address: form.get("address"),
        fbclid: new URLSearchParams(window.location.search).get("fbclid"),
      }),
    }).catch(() => null);

    const payload = await response?.json().catch(() => null) as {
      metaEvent?: MetaBrowserEventEnvelope | null;
    } | null | undefined;
    setStatus(response?.ok ? "sent" : "error");
    if (response?.ok) {
      if (payload?.metaEvent) trackConversion(payload.metaEvent);
      formElement.reset();
    }
  }

  return (
    <form onSubmit={submit}>
      <label>Name<input name="name" autoComplete="name" required /></label>
      <label>Email<input name="email" type="email" autoComplete="email" required /></label>
      <label>Phone<input name="phone" type="tel" autoComplete="tel" required /></label>
      <label>Property address<input name="address" autoComplete="street-address" required /></label>
      <button disabled={status === "sending"} type="submit">
        {status === "sending" ? "Sending…" : "Request an estimate"}
      </button>
      <p className="status" aria-live="polite">
        {status === "sent" && "Thanks — your request is in."}
        {status === "error" && "We could not send that request. Please try again."}
      </p>
    </form>
  );
}
