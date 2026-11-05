"use client";

import {useId,useRef,useState,type FormEvent} from "react";
import {inputClasses,labelClasses,primaryButtonClasses,secondaryButtonClasses} from "@/components/ui/form";
import {formatMeetingTimeShort} from "@/modules/booking/booking-format";
import type {BookingSummary} from "@/modules/booking/booking-service";
import type {QueueSnapshot} from "@/modules/setter-queue/schema";
import {formatWhen} from "./cockpit-format";

type Current=NonNullable<QueueSnapshot["current"]>;
type Choice={value:string;label:string;tone?:"success"|"danger"};

const CALL_OUTCOMES:Choice[]=[
  {value:"no_answer",label:"No answer"},
  {value:"voicemail",label:"Left voicemail"},
  {value:"callback_scheduled",label:"Callback"},
  {value:"not_interested",label:"Not interested",tone:"danger"},
  {value:"disqualified",label:"Disqualified",tone:"danger"},
  {value:"handoff",label:"Needs manager"},
];

/**
 * Every claim ends here. A booking made in this session preselects "Booked
 * virtual" with its appointment, so the happy path is one click.
 */
export function DispositionPanel({current,timezone,pending,onShift,booked,onSubmit}:{
  current:Current;timezone:string;pending:boolean;onShift:boolean;booked:BookingSummary|null;
  onSubmit:(form:FormData,claimNext:boolean)=>void;
}) {
  const id=useId();
  const [picked,setPicked]=useState("");
  const claimNext=useRef(onShift);
  const virtual=current.appointments.filter(a=>a.meeting_type==="virtual"&&a.reservable);
  const inHome=current.appointments.filter(a=>a.meeting_type==="in_person");
  // A booking made in this claim wins until the setter picks something else.
  const outcome=picked||(booked?"booked_virtual":"");
  const bookedChoices:Choice[]=[
    ...(booked||virtual.length?[{value:"booked_virtual",label:booked?`Booked ${formatMeetingTimeShort(booked.startsAt,timezone)}`:"Booked virtual",tone:"success" as const}]:[]),
    ...(inHome.length?[{value:"booked_in_home",label:"Booked in-home",tone:"success" as const}]:[]),
  ];
  const candidates=outcome==="booked_virtual"?virtual:outcome==="booked_in_home"?inHome:[];
  const fixedAppointment=outcome==="booked_virtual"&&booked?booked.appointmentId:candidates.length===1?candidates[0].id:null;
  const needsReason=outcome==="disqualified"||outcome==="handoff";

  // onSubmit rather than a form action: a failed save must not reset the
  // notes or callback time the setter just typed.
  function submit(event:FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form=new FormData(event.currentTarget);
    form.set("action","outcome");form.set("taskId",current.id);form.set("token",current.claim_token);
    onSubmit(form,onShift&&claimNext.current);
  }

  return <form onSubmit={submit} className="flex flex-col gap-4">
    <fieldset>
      <legend className="text-lg font-semibold tracking-tight">Outcome</legend>
      <p className="mt-0.5 text-sm text-ink-subtle">Required before the next homeowner.</p>
      <div className="mt-3 grid grid-cols-2 gap-2">
        {[...bookedChoices,...CALL_OUTCOMES].map(choice=>{
          const selected=outcome===choice.value;
          const wide=choice.tone==="success";
          const palette=selected
            ?choice.tone==="success"?"border-success bg-success text-white":choice.tone==="danger"?"border-danger bg-danger-bg text-danger ring-1 ring-danger":"border-accent bg-fill-selected text-accent ring-1 ring-accent"
            :choice.tone==="success"?"border-success/40 bg-success-bg text-success hover:border-success":"border-border-strong bg-surface text-ink hover:bg-fill-hover";
          return <label key={choice.value} className={`${wide?"col-span-2":""} cursor-pointer rounded-lg border px-3 py-2.5 text-center text-sm font-medium transition has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-tint ${palette}`}>
            <input type="radio" name="outcome" value={choice.value} required checked={selected} onChange={()=>setPicked(choice.value)} className="sr-only"/>
            {choice.label}
          </label>;
        })}
      </div>
    </fieldset>

    {outcome==="callback_scheduled" && <label className={labelClasses}>Callback time ({timezone})<input name="callbackLocal" type="datetime-local" required className={inputClasses}/></label>}
    {candidates.length>1 && !fixedAppointment && <label className={labelClasses}>Which appointment<select name="appointmentId" required className={inputClasses}>
      <option value="">Choose appointment</option>
      {candidates.map(a=><option key={a.id} value={a.id}>{formatWhen(a.scheduled_at,timezone)} · {a.status}</option>)}
    </select></label>}
    {fixedAppointment && <input type="hidden" name="appointmentId" value={fixedAppointment}/>}
    <label htmlFor={`${id}-notes`} className={labelClasses}>{needsReason?"Reason (required)":"Notes"}
      <textarea id={`${id}-notes`} name="notes" maxLength={2000} required={needsReason} rows={2} className={`${inputClasses} resize-y`}/>
    </label>

    <div className="flex flex-col gap-2">
      <button disabled={pending} onClick={()=>{claimNext.current=true;}} className={`${primaryButtonClasses} w-full py-2.5 text-sm`}>{pending?"Saving…":onShift?"Save & next lead":"Save outcome"}</button>
      {onShift && <button disabled={pending} onClick={()=>{claimNext.current=false;}} className={`${secondaryButtonClasses} w-full`}>Save & take a break</button>}
    </div>
  </form>;
}
