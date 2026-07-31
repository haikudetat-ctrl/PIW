import { RoofEstimateForm } from "./roof-estimate-form";

export default function PublicRoofEstimatePage() {
  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,#e9f1fb_0,transparent_38%),var(--color-page)] px-4 py-10 sm:py-16">
      <div className="mx-auto grid max-w-5xl gap-10 lg:grid-cols-[1fr_28rem] lg:items-center">
        <section>
          <p className="text-xs font-bold tracking-[0.2em] text-accent uppercase">New Jersey roof intelligence</p>
          <h1 className="mt-4 max-w-2xl text-4xl font-bold tracking-tight text-ink sm:text-5xl">See a preliminary roof replacement range in minutes.</h1>
          <p className="mt-5 max-w-xl text-lg leading-8 text-ink-muted">We use Google building and roof data to estimate roof size, then apply current New Jersey architectural-shingle pricing of $500–$750 per square.</p>
          <ul className="mt-8 grid gap-3 text-sm text-ink-muted">
            <li className="flex gap-3"><span className="font-bold text-success">✓</span> No site visit required for the preliminary range</li>
            <li className="flex gap-3"><span className="font-bold text-success">✓</span> Sent by both text and email</li>
            <li className="flex gap-3"><span className="font-bold text-success">✓</span> A roofing professional reviews exceptions</li>
          </ul>
        </section>
        <section className="rounded-2xl border border-border bg-surface p-6 shadow-[0_24px_70px_rgba(15,42,74,0.12)] sm:p-8">
          <RoofEstimateForm />
        </section>
      </div>
    </main>
  );
}
