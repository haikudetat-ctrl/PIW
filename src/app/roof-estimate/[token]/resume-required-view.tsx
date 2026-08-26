import Link from "next/link";
import { roofEstimateBrand } from "@/config/roof-estimate-brand";

export function ResumeRequiredView() {
  return (
    <main className="min-h-[100dvh] bg-[#eef3f5] px-4 py-8 text-slate-950 sm:px-6 sm:py-12">
      <div className="mx-auto flex min-h-[calc(100dvh-4rem)] max-w-3xl items-center justify-center sm:min-h-[calc(100dvh-6rem)]">
        <section className="w-full overflow-hidden rounded-[2rem] border border-white/80 bg-white shadow-[0_30px_90px_rgba(15,42,74,0.14)]">
          <div className="h-1.5 bg-gradient-to-r from-cyan-700 via-cyan-500 to-amber-400" />
          <div className="px-6 py-10 sm:px-12 sm:py-14">
            <div className="flex items-center gap-3 text-sm font-black tracking-[0.12em] text-slate-900">
              <span className="grid size-9 place-items-center rounded-full bg-slate-950 text-xs text-white" aria-hidden="true">
                AS
              </span>
              <span>{roofEstimateBrand.name.toUpperCase()}</span>
            </div>

            <p className="mt-10 text-xs font-bold uppercase tracking-[0.2em] text-cyan-700">
              Secure RoofCheck
            </p>
            <h1 className="mt-4 max-w-2xl text-4xl font-semibold tracking-[-0.045em] text-slate-950 sm:text-5xl">
              Your secure assessment link has expired.
            </h1>
            <p className="mt-6 max-w-xl text-base leading-7 text-slate-600 sm:text-lg">
              To protect your property details, this link can no longer reopen a saved assessment. Use the latest secure link we sent you to continue where you left off.
            </p>

            <div className="mt-8 rounded-2xl border border-slate-200 bg-slate-50 px-5 py-4 text-sm leading-6 text-slate-600">
              Can&apos;t find the newer link? Start a fresh RoofCheck and we&apos;ll securely match it to your property.
            </div>

            <Link
              href="/roof-estimate"
              className="mt-8 inline-flex min-h-14 w-full items-center justify-center rounded-2xl bg-slate-950 px-6 py-4 text-center text-sm font-black text-white transition hover:bg-slate-800 active:translate-y-px sm:w-auto"
            >
              Start a new RoofCheck
            </Link>
            <p className="mt-5 text-xs leading-5 text-slate-500">
              We never display saved answers from an expired link.
            </p>
          </div>
        </section>
      </div>
    </main>
  );
}
