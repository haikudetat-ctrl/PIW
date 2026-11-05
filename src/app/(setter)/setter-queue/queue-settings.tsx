"use client";

import Link from "next/link";
import {useState,useTransition} from "react";
import {useRouter} from "next/navigation";
import {inputClasses,labelClasses,plainButtonClasses,secondaryButtonClasses} from "@/components/ui/form";
import type {CallbackReport,QueueSnapshot} from "@/modules/setter-queue/schema";
import {runSetterQueueAction,type QueueActionResult} from "./actions";
import {BUCKET_LABELS,formatWhen} from "./cockpit-format";

/** Manager controls, kept off the cockpit so setters work on one screen. */
export function QueueSettings({snapshot,report,slaEnabled=false}:{snapshot:QueueSnapshot;report:CallbackReport;slaEnabled?:boolean}) {
  const router=useRouter();
  const [pending,startTransition]=useTransition();
  const [result,setResult]=useState<QueueActionResult|null>(null);

  function submit(form:FormData) {
    setResult(null);
    startTransition(async()=>{
      try {setResult(await runSetterQueueAction(form));} catch {setResult({ok:false,message:"Couldn't update the queue. Reload and try again."});}
      router.refresh();
    });
  }

  return <div className="admin-theme min-h-dvh bg-page text-ink">
    <header className="flex items-center justify-between border-b border-border bg-surface px-6 py-3">
      <Link href="/setter-queue" className={plainButtonClasses}>Back to setter queue</Link>
      <Link href="/" className={plainButtonClasses}>CRM</Link>
    </header>
    <main className="mx-auto max-w-4xl space-y-5 p-4 md:p-8">
      <h1 className="text-2xl font-semibold tracking-tight">Setter queue settings</h1>
      {result && <p role={result.ok?"status":"alert"} className={`rounded-lg border p-3 text-sm ${result.ok?"border-border bg-surface":"border-danger text-danger"}`}>{result.message}</p>}

      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-5">{BUCKET_LABELS.map(([key,label])=><div key={key} className="rounded-lg border border-border bg-surface p-4"><dt className="text-xs text-ink-subtle">{label}</dt><dd className="mt-1 text-2xl font-semibold tabular-nums">{snapshot.buckets[key]??0}</dd></div>)}</dl>

      <section className="space-y-4 rounded-xl border border-border bg-surface p-6">
        <h2 className="text-lg font-semibold">Queue</h2>
        {!slaEnabled && <p className="text-sm text-ink-subtle">The callback timer is paused in this environment. Ask your operator to enable it after confirming escalation coverage.</p>}
        <form action={submit} className="flex flex-wrap items-end gap-4"><input type="hidden" name="action" value="settings"/>
          <label className={labelClasses}>Queue<select name="enabled" defaultValue={String(snapshot.enabled)} className={inputClasses}><option value="false">Paused</option><option value="true">Enabled</option></select></label>
          <label className={labelClasses}>Company time zone<input name="timezone" defaultValue={snapshot.timezone} required className={inputClasses}/></label><button disabled={pending} className={secondaryButtonClasses}>Save settings</button>
        </form>
        <p className="text-sm text-ink-subtle">Confirm coverage before enabling. The callback worker releases untouched callbacks after 10 minutes and queues human recovery after 30 minutes.</p>
      </section>

      <section className="rounded-xl border border-border bg-surface p-6">
        <h2 className="text-lg font-semibold">Setter enrollment</h2>
        <ul className="mt-2 divide-y divide-border">{snapshot.members.map(member=><li key={member.user_id} className="flex flex-wrap items-center justify-between gap-3 py-3"><div><p className="text-sm font-medium">{member.name}</p><p className="text-xs text-ink-subtle">{member.role} · {member.enabled?"Enrolled":"Not enrolled"}{member.on_shift_until?` · Shift until ${formatWhen(member.on_shift_until,snapshot.timezone)}`:""}</p></div>
          <form action={submit}><input type="hidden" name="action" value="enroll"/><input type="hidden" name="userId" value={member.user_id}/><input type="hidden" name="enabled" value={String(!member.enabled)}/><button disabled={pending} className={secondaryButtonClasses}>{member.enabled?"Remove":"Enroll"} {member.name}</button></form></li>)}</ul>
      </section>

      <section className="rounded-xl border border-border bg-surface p-6">
        <h2 className="text-lg font-semibold">Missed callback windows · last 7 days</h2>
        {report.length?<ul className="mt-3 space-y-2 text-sm">{report.map(r=><li key={r.assigned_to??"unassigned"}>{r.name}: {r.missed} missed{r.delivery_issues?` · ${r.delivery_issues} Slack deliveries need reconciliation`:""}</li>)}</ul>:<p className="mt-3 text-sm text-ink-subtle">No missed windows recorded.</p>}
      </section>
    </main>
  </div>;
}
