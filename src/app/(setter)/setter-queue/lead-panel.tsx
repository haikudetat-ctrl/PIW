"use client";

import Link from "next/link";
import {useState} from "react";
import {secondaryButtonClasses,plainButtonClasses} from "@/components/ui/form";
import {Icon} from "@/components/ui/icons";
import type {QueueSnapshot} from "@/modules/setter-queue/schema";
import {formatAge,formatPhone,formatWhen,OUTCOME_LABELS} from "./cockpit-format";

type Current=NonNullable<QueueSnapshot["current"]>;
type Entry={at:string;kind:"call"|"outcome"|"text-in"|"text-out";title:string;body?:string|null};

function money(cents:number|null) {return cents===null?"—":new Intl.NumberFormat("en-US",{style:"currency",currency:"USD",maximumFractionDigits:0}).format(cents/100);}

function timeline(current:Current):Entry[] {
  const entries:Entry[]=[
    ...current.attempts.map(a=>({at:a.attempted_at,kind:"call" as const,title:"Call attempt"})),
    ...current.outcomes.map(o=>({at:o.created_at,kind:"outcome" as const,title:OUTCOME_LABELS[o.outcome]??o.outcome.replaceAll("_"," "),body:o.notes})),
    ...current.messages.map(m=>({at:m.created_at,kind:m.direction==="inbound"?"text-in" as const:"text-out" as const,title:m.direction==="inbound"?"Text from homeowner":`Text sent · ${m.status}`,body:m.body})),
  ];
  return entries.sort((a,b)=>b.at.localeCompare(a.at));
}

/**
 * Who to call and what has already happened. Setters see the name, number
 * and address to verify; lead source, stage and pricing stay with managers so
 * the call is never pre-judged.
 */
export function LeadPanel({current,timezone,isManager,pending,now,onAttempt}:{
  current:Current;timezone:string;isManager:boolean;pending:boolean;now:number|null;onAttempt:()=>void;
}) {
  const [copied,setCopied]=useState(false);
  const attempted=current.current_claim_attempted;
  const history=timeline(current);
  const waiting=current.due_at&&now?formatAge(new Date(current.due_at).getTime(),now):null;

  async function copy() {
    try {await navigator.clipboard.writeText(current.lead.phone);setCopied(true);setTimeout(()=>setCopied(false),1500);} catch {/* clipboard blocked; the number is on screen */}
  }

  return <>
    <section className="rounded-xl border border-border bg-surface p-5">
      <p className="text-xs font-semibold uppercase tracking-wide text-ink-subtle">{current.title}</p>
      <h1 className="mt-1.5 text-2xl font-semibold tracking-tight">{current.lead.name}</h1>
      <div className="mt-3 flex items-center gap-2">
        <a href={`tel:${current.lead.phone}`} className="text-xl font-semibold tabular-nums text-ink hover:text-tint">{formatPhone(current.lead.phone)}</a>
        <button type="button" onClick={copy} className="rounded-md px-1.5 py-1 text-xs font-medium text-ink-subtle hover:bg-fill-hover hover:text-ink">{copied?"Copied":"Copy"}</button>
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <a href={`tel:${current.lead.phone}`} onClick={()=>{if(!attempted&&!pending) onAttempt();}}
          className="inline-flex flex-1 items-center justify-center gap-2 rounded-lg bg-accent px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-accent-hover">
          <Icon name="phone"/>Call
        </a>
        {attempted
          ?<span className="inline-flex items-center gap-1.5 rounded-lg bg-success-bg px-3 py-2 text-sm font-medium text-success"><Icon name="check"/>Attempt logged</span>
          :<button type="button" disabled={pending} onClick={onAttempt} className={secondaryButtonClasses}>Log attempt</button>}
      </div>
      <p className="mt-2 text-xs text-ink-subtle">Dialing from CallTools? Use Log attempt when you start the call.</p>

      <dl className="mt-5 space-y-3 border-t border-border pt-4 text-sm">
        <div><dt className="text-xs text-ink-subtle">Address to verify</dt><dd className="mt-0.5 font-medium">{current.lead.address}</dd></div>
        <div><dt className="text-xs text-ink-subtle">Email for the invite</dt><dd className="mt-0.5 break-all">{current.lead.email}</dd></div>
        <div className="flex gap-6">
          <div><dt className="text-xs text-ink-subtle">Due</dt><dd className="mt-0.5 tabular-nums">{formatWhen(current.due_at,timezone)}</dd></div>
          {waiting && <div><dt className="text-xs text-ink-subtle">Waiting</dt><dd className="mt-0.5 tabular-nums">{waiting}</dd></div>}
        </div>
      </dl>
      {current.description && <p className="mt-4 whitespace-pre-wrap rounded-lg bg-info-bg p-3 text-sm text-ink">{current.description}</p>}

      {isManager && <div className="mt-4 space-y-1 border-t border-border pt-4 text-xs text-ink-subtle">
        <p>Manager view · {current.lead.source} · {current.lead.stage.replaceAll("_"," ")}</p>
        {current.estimate && <p>Estimate {money(current.estimate.range_low_cents)}–{money(current.estimate.range_high_cents)} · {current.estimate.roof_squares??"—"} squares</p>}
        <Link className={plainButtonClasses} href={`/leads/${current.lead.id}/dialer`} target="_blank">Full lead workspace</Link>
      </div>}
    </section>

    <section aria-label="History" className="flex min-h-48 flex-1 flex-col rounded-xl border border-border bg-surface">
      <h2 className="border-b border-border px-5 py-3 text-sm font-semibold">History <span className="font-normal text-ink-subtle">· {history.length}</span></h2>
      {history.length
        ?<ol className="min-h-0 flex-1 divide-y divide-border overflow-y-auto">
          {history.map((entry,i)=><li key={`${entry.kind}${i}`} className="px-5 py-2.5 text-sm">
            <div className="flex items-baseline justify-between gap-3">
              <span className={`font-medium ${entry.kind==="text-in"?"text-tint":""}`}>{entry.title}</span>
              <span className="shrink-0 text-xs tabular-nums text-ink-subtle">{formatWhen(entry.at,timezone)}</span>
            </div>
            {entry.body && <p className="mt-0.5 whitespace-pre-wrap text-ink-muted">{entry.body}</p>}
          </li>)}
        </ol>
        :<p className="px-5 py-4 text-sm text-ink-subtle">First contact. No calls or texts yet.</p>}
    </section>
  </>;
}
