"use client";

import {FormEvent, useEffect, useState} from "react";

type Props = {
  attemptId: string;
  onApproved?: (path: string) => void;
};

type ApiResponse = {
  status?: string;
  cooldownSeconds?: number;
  redirectTo?: string;
};

export function ResumeVerificationForm({attemptId, onApproved}: Props) {
  const [requested, setRequested] = useState(false);
  const [code, setCode] = useState("");
  const [cooldown, setCooldown] = useState(0);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = window.setInterval(() => setCooldown((value) => Math.max(0, value - 1)), 1_000);
    return () => window.clearInterval(timer);
  }, [cooldown]);

  async function post(body: unknown): Promise<ApiResponse> {
    const response = await fetch(`/api/roof-estimate/resume/${attemptId}`, {
      method: "POST",
      headers: {"content-type": "application/json"},
      body: JSON.stringify(body),
      cache: "no-store",
    });
    return response.json() as Promise<ApiResponse>;
  }

  async function requestCode() {
    setBusy(true);
    setError("");
    setStatus("Securely requesting a code. This can take a few seconds.");
    try {
      await post({action: "start"});
      setRequested(true);
      setCooldown(60);
      setStatus("A code was requested for the number on file. It may take a moment to arrive.");
    } catch {
      setRequested(true);
      setCooldown(60);
      setStatus("A code was requested for the number on file. It may take a moment to arrive.");
    } finally {
      setBusy(false);
    }
  }

  async function verify(event: FormEvent) {
    event.preventDefault();
    if (!/^[0-9]{6}$/.test(code)) {
      setError("Enter the six-digit code to continue.");
      return;
    }
    setBusy(true);
    setError("");
    setStatus("Securely confirming your code. This can take a few seconds.");
    try {
      const result = await post({action: "check", code});
      if (
        result.status === "approved"
        && typeof result.redirectTo === "string"
        && /^\/roof-estimate\/[0-9a-f-]{36}$/i.test(result.redirectTo)
      ) {
        (onApproved ?? ((path: string) => window.location.assign(path)))(result.redirectTo);
        return;
      }
      setError("We couldn't verify that code. Check the six digits and try again.");
    } catch {
      setError("We couldn't verify that code. Check the six digits and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main
      data-testid="resume-verification-card"
      data-overflow-fallback="compact-height-landscape-zoom"
      className="h-[100svh] min-h-[100svh] overflow-hidden bg-[#071724] px-4 py-4 [font-family:var(--font-montserrat)] [@media(max-height:640px)]:h-auto [@media(max-height:640px)]:overflow-y-auto sm:grid sm:place-items-center sm:px-6"
    >
      <section
        data-testid="resume-verification-panel"
        className="mx-auto flex h-[calc(100svh-2rem)] w-full max-w-lg flex-col justify-between overflow-hidden rounded-[1.75rem] border border-white/10 bg-[#f7f5ef] p-5 shadow-[0_30px_90px_rgba(0,0,0,0.35)] [@media(max-height:640px)]:h-auto [@media(max-height:640px)]:min-h-[calc(100svh-2rem)] [@media(max-height:640px)]:overflow-visible sm:h-auto sm:min-h-[37rem] sm:p-8"
      >
        <div>
          <div className="flex items-center justify-between border-b border-[#d9d4c8] pb-4">
            <div>
              <p className="text-[0.65rem] font-black tracking-[0.22em] text-[#0b2740]">ALL SEASON</p>
              <p className="mt-1 text-[0.6rem] font-bold uppercase tracking-[0.17em] text-[#64717b]">Secure assessment access</p>
            </div>
            <span aria-hidden className="grid size-9 place-items-center rounded-full bg-[#0b2740] text-sm font-black text-white">AS</span>
          </div>

          <p className="mt-7 text-xs font-black uppercase tracking-[0.2em] text-[#62717b]">One quick confirmation</p>
          <h1 className="mt-2 max-w-md text-[clamp(2.55rem,11vw,4rem)] leading-[0.9] tracking-[0.01em] text-[#0b2740] [font-family:var(--font-bebas-neue)]">
            Protecting your roof assessment
          </h1>
          <p className="mt-4 text-sm font-semibold leading-6 text-[#52616b]">
            We found an assessment already connected to this property. We&apos;ll send a private six-digit code to the number on file before reopening it.
          </p>

          {requested ? (
            <form className="mt-6" onSubmit={verify}>
              <label className="block text-xs font-black uppercase tracking-[0.16em] text-[#0b2740]" htmlFor="resume-code">
                Six-digit verification code
              </label>
              <input
                id="resume-code"
                autoComplete="one-time-code"
                inputMode="numeric"
                pattern="[0-9]{6}"
                maxLength={6}
                value={code}
                onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
                className="mt-2 h-14 w-full rounded-xl border border-[#bac2c3] bg-white px-4 text-center text-2xl font-black tracking-[0.45em] text-[#0b2740] outline-none transition focus:border-[#0b2740] focus:ring-4 focus:ring-[#0b2740]/10"
              />
              <button
                type="submit"
                disabled={busy || code.length !== 6}
                className="mt-4 h-14 w-full rounded-xl bg-[#0b2740] px-5 text-sm font-black text-white transition hover:bg-[#123b5d] disabled:cursor-not-allowed disabled:opacity-55"
              >
                {busy ? "Checking…" : "Verify and continue"}
              </button>
            </form>
          ) : null}
        </div>

        <div className="pt-4">
          <p role="status" aria-live="polite" className="min-h-10 text-xs font-semibold leading-5 text-[#62717b]">
            {status}
          </p>
          {error ? <p role="alert" className="mt-1 text-xs font-bold leading-5 text-[#9b2c2c]">{error}</p> : null}
          {!requested ? (
            <button
              type="button"
              disabled={busy}
              onClick={requestCode}
              className="mt-3 h-14 w-full rounded-xl bg-[#0b2740] px-5 text-sm font-black text-white transition hover:bg-[#123b5d] disabled:cursor-wait disabled:opacity-60"
            >
              {busy ? "Requesting code…" : "Send verification code"}
            </button>
          ) : (
            <button
              type="button"
              disabled={busy || cooldown > 0}
              onClick={requestCode}
              className="mt-3 w-full py-2 text-xs font-black text-[#0b2740] underline decoration-[#0b2740]/30 underline-offset-4 disabled:no-underline disabled:opacity-55"
            >
              {cooldown > 0 ? `Send again in ${cooldown}s` : "Send again"}
            </button>
          )}
          <p className="mt-2 text-center text-[0.65rem] font-semibold leading-4 text-[#7a858c]">
            We use this code only to protect access to the property assessment.
          </p>
        </div>
      </section>
    </main>
  );
}
