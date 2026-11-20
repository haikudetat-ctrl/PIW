import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import {
  formatAddress,
  formatLongDate,
  homeownerStatement,
  parsePrefill,
  photoReleaseText,
  reviewRequestText,
  workDescription,
} from "@/domain/closeouts";
import { canUseCrm, parseMyAccess } from "@/lib/auth/access";
import { createServerClient } from "@/lib/supabase/server";
import { SignoffForm } from "./signoff-form";

// The homeowner-facing screen, opened on the production manager's phone at
// the walkthrough. It sits outside the app layout so there is no
// navigation to wander into, and it shows nothing internal: no prices,
// notes or other customers.

export const metadata = { title: "Sign off on your roof" };

function Shell({ companyName, children }: { companyName: string; children: React.ReactNode }) {
  return (
    <main className="admin-theme min-h-screen bg-surface-muted px-4 py-8">
      <div className="mx-auto w-full max-w-xl">
        <p className="text-[13px] font-semibold tracking-wide text-tint uppercase">{companyName}</p>
        {children}
      </div>
    </main>
  );
}

export default async function SignoffPage({ params }: { params: Promise<{ closeoutId: string }> }) {
  const { closeoutId } = await params;
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data: accessRows } = await supabase.rpc("get_my_access");
  const access = parseMyAccess(accessRows);
  if (!access || !canUseCrm(access)) notFound();

  const [{ data: closeout }, { data: company }] = await Promise.all([
    supabase
      .from("job_closeouts")
      .select("id, version, status, job_jnid, prefill, install_completed_on, punch_items, homeowner_signed_at, homeowner_name")
      .eq("id", closeoutId)
      .maybeSingle(),
    supabase.from("companies").select("name").eq("id", access.companyId).maybeSingle(),
  ]);
  if (!closeout) notFound();

  const companyName = company?.name ?? "Your roofing contractor";
  const prefill = parsePrefill(closeout.prefill);
  const address = formatAddress(prefill.job);
  const backHref = `/closeouts/${encodeURIComponent(closeout.job_jnid)}`;

  if (closeout.homeowner_signed_at) {
    return (
      <Shell companyName={companyName}>
        <h1 className="mt-2 text-[28px] font-bold tracking-tight text-ink">Thank you, {closeout.homeowner_name}</h1>
        <p className="mt-3 text-[15px] text-ink-muted">
          Your sign-off is saved. Enjoy the new roof. You can hand the phone back now.
        </p>
        <Link href={backHref} className="mt-8 inline-block text-[13px] font-medium text-tint hover:underline">
          Back to the closeout
        </Link>
      </Shell>
    );
  }

  if (closeout.status !== "draft" || !closeout.install_completed_on) {
    return (
      <Shell companyName={companyName}>
        <h1 className="mt-2 text-[24px] font-bold tracking-tight text-ink">This sign-off isn&apos;t ready</h1>
        <p className="mt-3 text-[15px] text-ink-muted">
          {closeout.status !== "draft"
            ? "This closeout has already been submitted."
            : "The finish date needs to be saved before the homeowner signs."}
        </p>
        <Link href={backHref} className="mt-6 inline-block text-[13px] font-medium text-tint hover:underline">
          Back to the closeout
        </Link>
      </Shell>
    );
  }

  const statementInput = {
    companyName,
    workDescription: workDescription(prefill.job.job_type ?? null),
    address,
    completedOn: closeout.install_completed_on,
    openItems: closeout.punch_items,
  };

  return (
    <Shell companyName={companyName}>
      <h1 className="mt-2 text-[28px] font-bold tracking-tight text-ink">Your new roof is done</h1>
      <p className="mt-2 mb-6 text-[15px] text-ink-muted">
        {address}
        <br />
        Finished {formatLongDate(closeout.install_completed_on)}
      </p>
      <SignoffForm
        closeoutId={closeout.id}
        version={closeout.version}
        jobJnid={closeout.job_jnid}
        punchItems={closeout.punch_items}
        statementComplete={homeownerStatement({ ...statementInput, outcome: "complete" })}
        statementWithItems={homeownerStatement({ ...statementInput, outcome: "complete_with_items" })}
        photoReleaseText={photoReleaseText(companyName)}
        reviewRequestText={reviewRequestText(companyName)}
      />
      <Link href={backHref} className="mt-10 block text-center text-xs text-ink-subtle hover:underline">
        Project manager: back to the closeout
      </Link>
    </Shell>
  );
}
