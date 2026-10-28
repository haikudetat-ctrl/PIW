"use client";

import Link from "next/link";
import {useEffect,useState,useTransition} from "react";
import {useRouter} from "next/navigation";
import {inputClasses,labelClasses,primaryButtonClasses,secondaryButtonClasses} from "@/components/ui/form";
import type {CallbackReport,QueueSnapshot} from "@/modules/setter-queue/schema";
import {runSetterQueueAction,type QueueActionResult} from "./actions";

const BUCKETS=[['call_request','Call requests'],['scheduled_callback','Scheduled callbacks'],['new_lead','New leads'],['handoff','Handoffs'],['follow_up','Due follow-up']] as const;
function money(cents:number|null) {return cents===null?"—":new Intl.NumberFormat("en-US",{style:"currency",currency:"USD",maximumFractionDigits:0}).format(cents/100);}
function time(value:string|null,timezone:string) {return value?new Intl.DateTimeFormat("en-US",{timeZone:timezone,dateStyle:"medium",timeStyle:"short"}).format(new Date(value)):"—";}
function HiddenClaim({current}:{current:NonNullable<QueueSnapshot['current']>}) {
  return <><input type="hidden" name="taskId" value={current.id}/><input type="hidden" name="token" value={current.claim_token}/></>;
}

export function QueueWorkspace({snapshot,report,slaEnabled=false}:{snapshot:QueueSnapshot;report:CallbackReport;slaEnabled?:boolean}) {
  const router=useRouter();
  const [pending,startTransition]=useTransition();
  const [result,setResult]=useState<QueueActionResult|null>(null);
  const [outcome,setOutcome]=useState("");
  const current=snapshot.current;
  const onShift=!!snapshot.on_shift_until;

  useEffect(()=>{
    // Refresh counts, lease revocations and callback escalation even while a
    // setter waits on the page. A hidden tab fetches fresh state on return.
    const refresh=()=>{if(document.visibilityState==="visible") router.refresh();};
    const timer=setInterval(refresh,30_000);
    document.addEventListener("visibilitychange",refresh);
    return ()=>{clearInterval(timer);document.removeEventListener("visibilitychange",refresh);};
  },[router]);

  function submit(form:FormData) {
    setResult(null);
    startTransition(async()=>{
      try {setResult(await runSetterQueueAction(form));} catch {setResult({ok:false,message:"Couldn't update the queue. Reload and try again."});}
      router.refresh();
    });
  }

  return <div className="space-y-6">
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div><h1 className="text-2xl font-semibold tracking-tight">Setter queue</h1><p className="mt-1 text-sm text-ink-subtle">One homeowner at a time. Times shown in {snapshot.timezone}.</p></div>
      <div className="flex items-center gap-3">
        <button type="button" onClick={()=>router.refresh()} className={secondaryButtonClasses}>Refresh</button>
        {snapshot.enabled && snapshot.is_setter && <form action={submit}>
          <input type="hidden" name="action" value="shift"/><input type="hidden" name="onShift" value={String(!onShift)}/>
          <button disabled={pending||!!current} className={secondaryButtonClasses}>{onShift?"Go off shift":"Go on shift"}</button>
        </form>}
      </div>
    </div>
    {result && <div role={result.ok?"status":"alert"} className={`rounded-lg border p-3 text-sm ${result.ok?"border-border bg-surface":"border-danger text-danger"}`}>
      <p>{result.message}</p>{result.bookingUrl && <a href={result.bookingUrl} target="_blank" rel="noreferrer" className="mt-2 block break-all text-tint underline">Open homeowner booking link</a>}
    </div>}
    {!snapshot.enabled && <p className="rounded-lg border border-border bg-surface p-5">The queue is paused. A manager can enable it below after confirming setter coverage.</p>}
    {snapshot.enabled && <>
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-5">{BUCKETS.map(([key,label])=><div key={key} className="rounded-lg border border-border bg-surface p-4"><dt className="text-xs text-ink-subtle">{label}</dt><dd className="mt-1 text-2xl font-semibold tabular-nums">{snapshot.buckets[key]??0}</dd></div>)}</dl>
      {snapshot.is_setter && !current && <div className="rounded-lg border border-border bg-surface p-6">
        <h2 className="text-lg font-semibold">{onShift?"Ready for the next homeowner":"Start your shift"}</h2>
        <p className="my-3 text-sm text-ink-subtle">{onShift?"Claim the highest-priority available task. An unfinished claim resumes before another lead.":"Go on shift to receive leads. A shift expires after eight hours."}</p>
        {onShift && <form action={submit}><input type="hidden" name="action" value="claim"/><button disabled={pending} className={primaryButtonClasses}>Claim next lead</button></form>}
      </div>}
      {!snapshot.is_setter && <p className="text-sm text-ink-subtle">Enroll yourself below if you also make calls.</p>}
      {current && <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]" key={current.claim_token}>
        <div className="space-y-5">
          <section className="rounded-xl border border-border bg-surface p-6">
            <p className="text-xs font-semibold uppercase tracking-wide text-ink-subtle">{current.title}</p>
            <h2 className="mt-2 text-2xl font-semibold">{current.lead.name}</h2>
            <p className="mt-2 text-sm">{current.lead.address}</p><p className="mt-1 text-sm text-ink-subtle">{current.lead.source} · {current.lead.stage.replaceAll("_"," ")}</p>
            <p className="mt-3 text-sm">{current.lead.phone} · <a className="text-tint underline" href={`mailto:${current.lead.email}`}>{current.lead.email}</a></p>
            <p className="mt-3 text-xs text-ink-subtle">Due {time(current.due_at,snapshot.timezone)} · Claim until {time(current.claim_expires_at,snapshot.timezone)}</p>
            <form action={submit} className="mt-3"><input type="hidden" name="action" value="claim"/><button disabled={pending} className="text-xs font-medium text-tint underline">Extend current claim</button></form>
            {current.description && <p className="mt-3 whitespace-pre-wrap text-sm">{current.description}</p>}
            {current.estimate && <div className="mt-4 border-t border-border pt-4"><p className="text-sm font-medium">Estimate: {money(current.estimate.range_low_cents)}–{money(current.estimate.range_high_cents)}</p><p className="mt-1 text-sm text-ink-subtle">{current.estimate.roof_squares??"—"} measured squares · {current.estimate.status}</p></div>}
            {snapshot.is_manager && <Link className="mt-4 inline-block text-sm text-tint underline" href={`/leads/${current.lead.id}/dialer`} target="_blank">Full lead workspace and property context</Link>}
          </section>
          <section className="rounded-xl border border-border bg-surface p-6">
            <h3 className="font-semibold">Manual call</h3><p className="mt-2 text-sm text-ink-subtle">Call through CallTools or your phone. Record the attempt when you start dialing, then save the outcome here.</p>
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <form action={submit}><HiddenClaim current={current}/><input type="hidden" name="action" value="attempt"/><button disabled={pending||current.current_claim_attempted} className={primaryButtonClasses}>{current.current_claim_attempted?"Attempt recorded":"Record call attempt"}</button></form>
              <a className={secondaryButtonClasses} href={`tel:${current.lead.phone}`}>Dial {current.lead.phone}</a>
            </div>
            <p className="mt-3 text-xs text-ink-subtle">Attempts are setter-reported. No-answer and voicemail count as attempts.</p>
          </section>
          <section className="rounded-xl border border-border bg-surface p-6">
            <h3 className="font-semibold">Text conversation</h3><p className="mt-1 text-xs text-ink-subtle">Read-only history · latest 200 messages.</p>
            <ol className="mt-4 max-h-80 space-y-3 overflow-y-auto">{current.messages.map((m,i)=><li key={i} className="rounded-lg bg-surface-muted p-3 text-sm"><p className="whitespace-pre-wrap">{m.body}</p><p className="mt-1 text-xs text-ink-subtle">{m.direction} · {m.status} · {time(m.created_at,snapshot.timezone)}</p></li>)}</ol>
            {!current.messages.length && <p className="mt-3 text-sm text-ink-subtle">No text messages yet.</p>}
          </section>
          <section className="rounded-xl border border-border bg-surface p-6">
            <h3 className="font-semibold">Call history</h3>
            <ul className="mt-3 space-y-2 text-sm">{current.attempts.map((a,i)=><li key={`a${i}`}>Manual attempt · {time(a.attempted_at,snapshot.timezone)}</li>)}{current.outcomes.map((o,i)=><li key={`o${i}`} className="border-t border-border pt-2">{o.outcome.replaceAll("_"," ")} · {time(o.created_at,snapshot.timezone)}{o.notes && <p className="whitespace-pre-wrap text-ink-subtle">{o.notes}</p>}</li>)}</ul>
            {!current.attempts.length && !current.outcomes.length && <p className="mt-3 text-sm text-ink-subtle">No recorded calls yet.</p>}
          </section>
        </div>
        <div className="space-y-5">
          <section className="rounded-xl border border-border bg-surface p-6">
            <h3 className="font-semibold">Book a virtual inspection</h3><p className="mt-2 text-sm text-ink-subtle">Choose real availability with the homeowner. Refresh after booking to record the appointment outcome.</p>
            <form action={submit} className="mt-4"><HiddenClaim current={current}/><input type="hidden" name="action" value="booking_link"/><button disabled={pending} className={secondaryButtonClasses}>Get virtual booking link</button></form>
            <p className="mt-3 text-xs text-ink-subtle">For an in-home inspection, request manager assistance using Human handoff.</p>
          </section>
          <form action={submit} className="space-y-4 rounded-xl border border-border bg-surface p-6">
            <h3 className="font-semibold">Record the outcome</h3><p className="text-sm text-ink-subtle">Required before the next homeowner.</p>
            <HiddenClaim current={current}/><input type="hidden" name="action" value="outcome"/>
            <label className={labelClasses}>Outcome<select name="outcome" required value={outcome} onChange={e=>setOutcome(e.target.value)} className={inputClasses}>
              <option value="">Choose an outcome</option><option value="no_answer">No answer</option><option value="voicemail">Voicemail</option><option value="callback_scheduled">Callback scheduled</option>
              {current.appointments.some(a=>a.meeting_type==="virtual"&&a.reservable) && <option value="booked_virtual">Booked virtual</option>}
              {current.appointments.some(a=>a.meeting_type==="in_person") && <option value="booked_in_home">Booked in-home</option>}
              <option value="not_interested">Not interested — stop follow-up</option><option value="disqualified">Disqualified</option><option value="handoff">Human handoff</option>
            </select></label>
            {outcome==="callback_scheduled" && <label className={labelClasses}>Callback time ({snapshot.timezone})<input name="callbackLocal" type="datetime-local" required className={inputClasses}/></label>}
            {outcome.startsWith("booked_") && <label className={labelClasses}>Existing appointment<select name="appointmentId" required className={inputClasses}><option value="">Choose appointment</option>{current.appointments.filter(a=>outcome==="booked_virtual"?a.meeting_type==="virtual"&&a.reservable:a.meeting_type==="in_person").map(a=><option key={a.id} value={a.id}>{time(a.scheduled_at,snapshot.timezone)} · {a.status}</option>)}</select></label>}
            <label className={labelClasses}>Notes / reason<textarea name="notes" maxLength={2000} required={outcome==="disqualified"||outcome==="handoff"} className={`${inputClasses} min-h-24`}/></label>
            <button disabled={pending} className={primaryButtonClasses}>{pending?"Saving…":"Save outcome"}</button>
          </form>
        </div>
      </div>}
    </>}
    {snapshot.is_manager && <section className="space-y-5 rounded-xl border border-border bg-surface p-6">
      <h2 className="text-lg font-semibold">Queue settings</h2>
      {!slaEnabled && <p className="text-sm text-ink-subtle">The callback timer is paused in this environment. Ask your operator to enable it after confirming escalation coverage.</p>}
      <form action={submit} className="flex flex-wrap items-end gap-4"><input type="hidden" name="action" value="settings"/>
        <label className={labelClasses}>Queue<select name="enabled" defaultValue={String(snapshot.enabled)} className={inputClasses}><option value="false">Paused</option><option value="true">Enabled</option></select></label>
        <label className={labelClasses}>Company time zone<input name="timezone" defaultValue={snapshot.timezone} required className={inputClasses}/></label><button disabled={pending} className={secondaryButtonClasses}>Save settings</button>
      </form>
      <p className="text-sm text-ink-subtle">Confirm coverage before enabling. The callback worker releases untouched callbacks after 10 minutes and queues human recovery after 30 minutes.</p>
      <h3 className="font-semibold">Setter enrollment</h3>
      <ul className="divide-y divide-border">{snapshot.members.map(member=><li key={member.user_id} className="flex flex-wrap items-center justify-between gap-3 py-3"><div><p className="text-sm font-medium">{member.name}</p><p className="text-xs text-ink-subtle">{member.role} · {member.enabled?"Enrolled":"Not enrolled"}{member.on_shift_until?` · Shift until ${time(member.on_shift_until,snapshot.timezone)}`:""}</p></div>
        <form action={submit}><input type="hidden" name="action" value="enroll"/><input type="hidden" name="userId" value={member.user_id}/><input type="hidden" name="enabled" value={String(!member.enabled)}/><button disabled={pending} className={secondaryButtonClasses}>{member.enabled?"Remove":"Enroll"} {member.name}</button></form></li>)}</ul>
      <h3 className="font-semibold">Missed callback windows · last 7 days</h3>
      {report.length?<ul className="space-y-2 text-sm">{report.map(r=><li key={r.assigned_to??"unassigned"}>{r.name}: {r.missed} missed{r.delivery_issues?` · ${r.delivery_issues} Slack deliveries need reconciliation`:""}</li>)}</ul>:<p className="text-sm text-ink-subtle">No missed windows recorded.</p>}
    </section>}
  </div>;
}
