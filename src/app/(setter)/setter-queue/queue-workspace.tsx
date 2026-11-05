"use client";

import Link from "next/link";
import {useEffect,useState,useTransition,type ReactNode} from "react";
import {useRouter} from "next/navigation";
import {plainButtonClasses,primaryButtonClasses,secondaryButtonClasses} from "@/components/ui/form";
import {Icon} from "@/components/ui/icons";
import {RakeLogo} from "@/components/brand/rake-logo";
import {formatClockTime} from "@/modules/booking/booking-format";
import type {BookingSummary} from "@/modules/booking/booking-service";
import type {QueueSnapshot} from "@/modules/setter-queue/schema";
import {runSetterQueueAction,type QueueActionResult} from "./actions";
import {ApprovedTexting} from "./approved-texting";
import {BUCKET_LABELS,formatCountdown} from "./cockpit-format";
import {DispositionPanel} from "./disposition-panel";
import {LeadPanel} from "./lead-panel";
import {VirtualBooking} from "./virtual-booking";

type Current=NonNullable<QueueSnapshot["current"]>;
type Submit=(form:FormData,claimNext?:boolean)=>void;

function command(action:string,fields:Record<string,string>={}) {
  const form=new FormData();form.set("action",action);
  for(const [key,value] of Object.entries(fields)) form.set(key,value);
  return form;
}
function claimFields(current:Current) {return {taskId:current.id,token:current.claim_token};}

/** Ticks once a second after mount; null during server render so markup matches. */
function useNow() {
  const [now,setNow]=useState<number|null>(null);
  useEffect(()=>{
    const tick=()=>setNow(Date.now());
    tick();
    const timer=setInterval(tick,1000);
    return ()=>clearInterval(timer);
  },[]);
  return now;
}

/**
 * Setter cockpit: one homeowner, one screen. Lead and call on the left,
 * booking in the center because the goal of every call is an appointment,
 * outcome on the right. Panels scroll on their own; the page does not.
 */
export function QueueWorkspace({snapshot,signOut}:{snapshot:QueueSnapshot;signOut?:ReactNode}) {
  const router=useRouter();
  const [pending,startTransition]=useTransition();
  const [result,setResult]=useState<QueueActionResult|null>(null);
  const now=useNow();
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

  const submit:Submit=(form,claimNext=false)=>{
    setResult(null);
    startTransition(async()=>{
      let next:QueueActionResult;
      try {next=await runSetterQueueAction(form);} catch {next={ok:false,message:"Couldn't update the queue. Reload and try again."};}
      if(next.ok && claimNext) {
        try {
          const claimed=await runSetterQueueAction(command("claim"));
          next=claimed.ok?{ok:true,message:`${next.message} · ${claimed.message}`}:claimed;
        } catch {next={ok:false,message:`${next.message}, but the next lead couldn't be claimed. Press Claim next lead.`};}
      }
      const settled=next;
      // Keep the result and refresh inside the transition so buttons re-enable
      // in the same commit that shows the outcome.
      startTransition(()=>{setResult(settled);router.refresh();});
    });
  };

  const claimLeft=current&&now?new Date(current.claim_expires_at).getTime()-now:null;

  return <div className="admin-theme flex min-h-dvh flex-col bg-page text-ink lg:h-dvh">
    <header className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-border bg-surface px-4 py-2.5">
      <div className="flex items-center gap-2"><RakeLogo className="h-3.5 w-auto text-ink"/><span className="text-sm font-medium text-ink-subtle">Setter</span></div>
      {snapshot.is_setter && <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${onShift?"bg-success-bg text-success":"bg-surface-muted text-ink-muted"}`}>
        <span aria-hidden className="size-1.5 rounded-full bg-current"/>{snapshot.on_shift_until?`On shift until ${formatClockTime(snapshot.on_shift_until,snapshot.timezone)}`:"Off shift"}
      </span>}
      {current && <div className="flex items-center gap-2 text-xs">
        <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 font-medium tabular-nums ${claimLeft!==null&&claimLeft<60_000?"bg-danger-bg text-danger":claimLeft!==null&&claimLeft<300_000?"bg-warning-bg text-warning":"bg-surface-muted text-ink-muted"}`}>
          <Icon name="clock" size={13}/>Claim {claimLeft===null?"—":formatCountdown(claimLeft)}
        </span>
        <button type="button" disabled={pending} onClick={()=>submit(command("claim"))} className={plainButtonClasses}>Extend</button>
      </div>}
      <div aria-live="polite" className="min-w-0 flex-1">
        {result && <p role={result.ok?"status":"alert"} className={`truncate text-sm ${result.ok?"text-ink-muted":"font-medium text-danger"}`}>
          {result.message}{result.bookingUrl && <> · <a href={result.bookingUrl} target="_blank" rel="noreferrer" className="text-tint underline">Open booking link</a></>}
        </p>}
      </div>
      {snapshot.is_manager && snapshot.enabled && <dl aria-label="Queue" className="hidden items-center gap-3 text-xs xl:flex">
        {BUCKET_LABELS.map(([key,label])=><div key={key} className="flex items-baseline gap-1"><dt className="text-ink-subtle">{label}</dt><dd className="font-semibold tabular-nums">{snapshot.buckets[key]??0}</dd></div>)}
      </dl>}
      <div className="flex items-center gap-2">
        {snapshot.enabled && snapshot.is_setter && <button type="button" disabled={pending||!!current} title={current?"Record an outcome before going off shift":undefined}
          onClick={()=>submit(command("shift",{onShift:String(!onShift)}))} className={secondaryButtonClasses}>{onShift?"Go off shift":"Go on shift"}</button>}
        {snapshot.is_manager && <Link href="/setter-queue/settings" className={secondaryButtonClasses}><Icon name="settings" size={14}/>Settings</Link>}
        {snapshot.is_manager && <Link href="/" className={plainButtonClasses}>CRM</Link>}
        <button type="button" aria-label="Refresh" title="Refresh" onClick={()=>router.refresh()} className="rounded-md p-1.5 text-ink-subtle hover:bg-fill-hover hover:text-ink">
          <svg aria-hidden width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round"><path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v7h-7"/></svg>
        </button>
        {signOut}
      </div>
    </header>

    {current && snapshot.enabled
      ?<Cockpit key={current.claim_token} snapshot={snapshot} current={current} pending={pending} onShift={onShift} now={now} submit={submit}/>
      :<Idle snapshot={snapshot} pending={pending} onShift={onShift} submit={submit}/>}
  </div>;
}

function Idle({snapshot,pending,onShift,submit}:{snapshot:QueueSnapshot;pending:boolean;onShift:boolean;submit:Submit}) {
  let title="Ready for the next homeowner",body="You get one lead at a time, highest priority first. An unfinished claim resumes before a new lead.",action:ReactNode=null;
  if(!snapshot.enabled) {title="The queue is paused";body=snapshot.is_manager?"Enable it in Settings once setter coverage is confirmed.":"A manager will turn it back on.";}
  else if(!snapshot.is_setter) {title="You're not enrolled as a setter";body="Enroll yourself in Settings if you also make calls.";}
  else if(!onShift) {
    title="Start your shift";body="Go on shift to receive leads. A shift lasts eight hours.";
    action=<button type="button" disabled={pending} onClick={()=>submit(command("shift",{onShift:"true"}))} className={`${primaryButtonClasses} px-6 py-2.5 text-sm`}>Go on shift</button>;
  } else {
    action=<button type="button" disabled={pending} onClick={()=>submit(command("claim"))} className={`${primaryButtonClasses} px-6 py-2.5 text-sm`}>{pending?"Claiming…":"Claim next lead"}</button>;
  }
  return <main className="flex flex-1 items-center justify-center p-6">
    <div className="w-full max-w-md rounded-xl border border-border bg-surface p-8 text-center">
      <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
      <p className="mx-auto mt-2 max-w-sm text-sm text-ink-subtle">{body}</p>
      {action && <div className="mt-6">{action}</div>}
      {snapshot.is_manager && <Link href="/setter-queue/settings" className={`${plainButtonClasses} mt-6`}>Queue settings</Link>}
    </div>
  </main>;
}

function Cockpit({snapshot,current,pending,onShift,now,submit}:{
  snapshot:QueueSnapshot;current:Current;pending:boolean;onShift:boolean;now:number|null;submit:Submit;
}) {
  const router=useRouter();
  const [booked,setBooked]=useState<BookingSummary|null>(null);
  const column="flex min-h-0 min-w-0 flex-col gap-3 lg:overflow-y-auto";
  return <main className="grid flex-1 grid-cols-1 gap-3 p-3 lg:min-h-0 lg:grid-cols-[minmax(17rem,22rem)_minmax(0,1fr)_minmax(16rem,20rem)]">
    <div className={column}>
      <LeadPanel current={current} timezone={snapshot.timezone} isManager={snapshot.is_manager} pending={pending} now={now}
        onAttempt={()=>submit(command("attempt",claimFields(current)))}/>
    </div>
    <div className={column}>
      <div className="rounded-xl border border-border bg-surface p-5">
        <VirtualBooking current={current} onBooked={booking=>{setBooked(booking);router.refresh();}}/>
      </div>
      <details className="group rounded-xl border border-border bg-surface">
        <summary className="flex cursor-pointer list-none items-center justify-between px-5 py-3 text-sm font-medium">
          <span>Can&apos;t book on this call? Send a text or a self-booking link</span>
          <Icon name="chevronDown" className="text-ink-subtle transition group-open:rotate-180"/>
        </summary>
        <div className="grid gap-5 border-t border-border p-5 md:grid-cols-2">
          <ApprovedTexting key={`${current.id}:${current.claim_token}`} current={current}/>
          <div>
            <h3 className="text-sm font-semibold">Self-booking link</h3>
            <p className="mt-0.5 text-xs text-ink-subtle">For a homeowner who wants to pick a time later. It books the same real capacity.</p>
            <button type="button" disabled={pending} onClick={()=>submit(command("booking_link",claimFields(current)))} className={`${secondaryButtonClasses} mt-3`}>Get booking link</button>
            <p className="mt-4 text-xs text-ink-subtle">In-home inspection requested? Choose Needs manager.</p>
          </div>
        </div>
      </details>
    </div>
    <div className={column}>
      <div className="rounded-xl border border-border bg-surface p-5">
        <DispositionPanel current={current} timezone={snapshot.timezone} pending={pending} onShift={onShift} booked={booked} onSubmit={submit}/>
      </div>
    </div>
  </main>;
}
