import type {Metadata} from "next";

export const metadata: Metadata = {
  title: "Privacy policy | AllSeason Solar & Roofing",
  description: "How AllSeason Solar & Roofing uses and protects information in its online services.",
};

export default function PrivacyPage() {
  return (
    <main className="mx-auto w-full max-w-3xl px-6 py-12 text-slate-800 sm:py-16">
      <header className="border-b border-slate-200 pb-8">
        <p className="text-sm font-bold uppercase tracking-widest text-emerald-800">
          Policy version <span>piw-privacy-v1</span>
        </p>
        <h1 className="mt-3 text-4xl font-bold tracking-tight text-slate-950">
          Privacy policy
        </h1>
        <p className="mt-4 text-lg leading-8">
          This notice explains how AllSeason Solar &amp; Roofing uses information
          when you request, complete, or review an online roof assessment.
        </p>
      </header>

      <div className="space-y-10 py-10 leading-7">
        <section aria-labelledby="necessary-heading">
          <h2 id="necessary-heading" className="text-2xl font-bold text-slate-950">Necessary</h2>
          <p className="mt-3">
            Necessary technology supports security, fraud prevention, consent
            records, page navigation, and the quote and assessment features you
            request. It is always on because the service cannot operate safely
            without it.
          </p>
        </section>

        <section aria-labelledby="analytics-heading">
          <h2 id="analytics-heading" className="text-2xl font-bold text-slate-950">Analytics</h2>
          <p className="mt-3">
            When you allow Analytics, we may measure how visitors use the site,
            where an assessment succeeds or encounters an error, and how the
            experience performs. We do not use Analytics when you decline it.
          </p>
        </section>

        <section aria-labelledby="advertising-heading">
          <h2 id="advertising-heading" className="text-2xl font-bold text-slate-950">Advertising</h2>
          <p className="mt-3">
            When you allow Advertising, Meta Pixel and Conversions API may be used
            to measure advertising results and avoid counting the same action twice.
            Meta technology is not used for this purpose when Advertising is off,
            and Global Privacy Control keeps Advertising off.
          </p>
        </section>

        <section aria-labelledby="scheduling-heading">
          <h2 id="scheduling-heading" className="text-2xl font-bold text-slate-950">
            Scheduling with Cal.com
          </h2>
          <p className="mt-3">
            If you choose to schedule a consultation, Cal.com processes the booking
            details needed to show availability, create the appointment, and provide
            confirmation, rescheduling, or cancellation options. Scheduling is optional.
          </p>
        </section>

        <section aria-labelledby="retention-heading">
          <h2 id="retention-heading" className="text-2xl font-bold text-slate-950">
            Consent records and retention
          </h2>
          <p className="mt-3">
            We retain consent evidence—including the policy version, category choices,
            time of the choice, a random consent identifier, and bounded request
            information—as needed to document and honor your choices. Changing a choice
            stops future nonessential collection; it does not rewrite historical evidence.
          </p>
        </section>

        <section aria-labelledby="choices-heading">
          <h2 id="choices-heading" className="text-2xl font-bold text-slate-950">
            Change your choices
          </h2>
          <p className="mt-3">
            Use the <strong>Privacy choices</strong> button, available on every page,
            to reopen your preferences at any time. Rejecting nonessential technology
            does not stop you from submitting a quote request or using an assessment.
          </p>
        </section>

        <section aria-labelledby="contact-heading">
          <h2 id="contact-heading" className="text-2xl font-bold text-slate-950">Contact us</h2>
          <p className="mt-3">
            For privacy questions or requests, call AllSeason Solar &amp; Roofing at{" "}
            <a className="font-bold text-emerald-800 underline" href="tel:+18888325050">
              (888) 832-5050
            </a>.
          </p>
        </section>
      </div>
    </main>
  );
}
