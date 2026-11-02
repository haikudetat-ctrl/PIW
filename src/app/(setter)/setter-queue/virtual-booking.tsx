"use client";

import {useId,useState,useTransition,type FormEvent} from "react";
import {inputClasses,labelClasses,primaryButtonClasses,secondaryButtonClasses} from "@/components/ui/form";
import {formatClockTime,formatMeetingTime,timeZoneAbbreviation} from "@/modules/booking/booking-format";
import type {BookingSummary} from "@/modules/booking/booking-service";
import type {SetterBookingAvailability} from "@/modules/booking/setter-booking-runtime";
import type {QueueSnapshot} from "@/modules/setter-queue/schema";
import {runSetterBookingAction,type SetterBookingResult} from "./booking-actions";

const dateLabel=new Intl.DateTimeFormat("en-US",{timeZone:"UTC",weekday:"long",month:"long",day:"numeric",year:"numeric"});
export function VirtualBooking({current,onSaved}:{current:NonNullable<QueueSnapshot["current"]>;onSaved:()=>void}) {
  const id=useId();
  const [pending,startTransition]=useTransition();
  const [availability,setAvailability]=useState<SetterBookingAvailability|null>(null);
  const [result,setResult]=useState<SetterBookingResult|null>(null);
  const [saved,setSaved]=useState<BookingSummary|null>(null);
  const [bookingTimezone,setBookingTimezone]=useState("UTC");
  const [mode,setMode]=useState<"book"|"reschedule"|null>(null);
  const [date,setDate]=useState("");
  const [slot,setSlot]=useState("");
  const [lostClaim,setLostClaim]=useState(false);
  const model=availability?.model;
  const booking=saved??model?.booking;
  const days=model?.days.filter(d=>d.slots.length)??[];
  const selectedDay=days.find(d=>d.date===date);

  function claimForm(action:string) {
    const form=new FormData();form.set("action",action);form.set("taskId",current.id);form.set("token",current.claim_token);return form;
  }
  function applyAvailability(value:SetterBookingAvailability) {
    setBookingTimezone(value.model.timezone);
    setAvailability(value);setSaved(null);setDate(value.model.days.find(d=>d.slots.length)?.date??"");setSlot("");
    setMode(value.model.booking?null:"book");
  }
  function run(form:FormData) {
    setResult(null);
    startTransition(async()=>{
      let next:SetterBookingResult;
      try {next=await runSetterBookingAction(form);} catch {next={ok:false,message:"Couldn't reach virtual booking. Try again.",code:"unavailable"};}
      setResult(next);
      if(next.availability) applyAvailability(next.availability);
      if(next.code==="claim_changed") {setLostClaim(true);setAvailability(null);setSaved(null);setMode(null);}
      if(!next.ok && ["calendar","unavailable"].includes(next.code??"")) {
        setAvailability(previous=>previous?.model.booking?{...previous,calendarAvailable:false,model:{...previous.model,days:[]}}:null);
        setSlot("");setMode(null);
      }
      if(!next.ok && ["slot_unavailable","booking_changed","already_booked"].includes(next.code??"")) {
        setSlot("");
        if(!next.availability) {setAvailability(null);setMode(null);}
      }
      if(next.ok && next.booking) {setSaved(next.booking);setAvailability(null);setMode(null);setSlot("");onSaved();}
    });
  }
  function save(event:FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if(!slot || !mode) return;
    const fields=new FormData(event.currentTarget);
    const form=claimForm(mode);form.set("startsAt",slot);
    if(mode==="reschedule") {
      if(!model?.booking || !availability?.revision) return;
      form.set("appointmentId",model.booking.appointmentId);form.set("revision",String(availability.revision));
    } else {
      form.set("attendeeEmail",String(fields.get("attendeeEmail")??""));form.set("notes",String(fields.get("notes")??""));
    }
    run(form);
  }

  return <div className="space-y-4">
    <div><h3 className="font-semibold">Book a virtual inspection</h3><p className="mt-2 text-sm text-ink-subtle">Choose a real available time with the homeowner. Saving keeps your claim open until you record the call outcome.</p></div>
    {result && (result.ok?(result.booking && <p role="status" className="rounded-lg border border-border bg-surface-muted p-3 text-sm">{result.message}</p>):<p role="alert" className="rounded-lg border border-danger p-3 text-sm text-danger">{result.message}</p>)}
    {booking && <div className="rounded-lg border border-border bg-surface-muted p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-ink-subtle">Current virtual inspection</p>
      <p className="mt-2 font-medium">{formatMeetingTime(booking.startsAt,model?.timezone??bookingTimezone)}</p>
      <p className="mt-1 text-sm text-ink-subtle">Invite: {booking.inviteEmail??"homeowner email"} · {booking.durationMinutes} minutes</p>
      {model?.booking?.canChange && availability?.revision && mode!=="reschedule" && <button type="button" disabled={pending||!days.length} className={`${secondaryButtonClasses} mt-3`} onClick={()=>{setMode("reschedule");setSlot("");}}>Move inspection</button>}
    </div>}
    <button type="button" disabled={pending||lostClaim} className={secondaryButtonClasses} onClick={()=>run(claimForm("load"))}>{pending?"Checking availability…":availability?"Refresh available times":"Load available times"}</button>
    {lostClaim && <p className="text-sm text-ink-subtle">Refresh the queue to continue.</p>}
    {availability?.calendarAvailable===false && result?.ok!==false && <p role="alert" className="text-sm text-danger">Calendar availability couldn&apos;t be checked. Your existing inspection keeps its current time. Refresh available times to try again.</p>}
    {model && availability?.calendarAvailable && !days.length && <p className="text-sm text-ink-subtle">No times are available. Ask your manager to review capacity or refresh later. Any existing inspection keeps its current time.</p>}
    {model && availability?.calendarAvailable && days.length>0 && mode && <form onSubmit={save} className="space-y-4 border-t border-border pt-4">
      <p className="text-sm text-ink-subtle">{model.durationMinutes} minutes · Times shown in {model.timezone}</p>
      <label htmlFor={`${id}-date`} className={labelClasses}>Inspection date<select id={`${id}-date`} value={date} disabled={pending} className={inputClasses} onChange={e=>{setDate(e.target.value);setSlot("");}}>{days.map(day=><option key={day.date} value={day.date}>{dateLabel.format(new Date(`${day.date}T12:00:00Z`))}</option>)}</select></label>
      <label htmlFor={`${id}-time`} className={labelClasses}>Inspection time ({model.timezone})<select id={`${id}-time`} value={slot} required disabled={pending} className={inputClasses} onChange={e=>setSlot(e.target.value)}>
        <option value="">Choose a time</option>{selectedDay?.slots.map(s=><option key={s.startsAt} value={s.startsAt}>{formatClockTime(s.startsAt,model.timezone)} {timeZoneAbbreviation(s.startsAt,model.timezone)}</option>)}
      </select></label>
      {mode==="book" && <>
        <label className={labelClasses}>Invite email<input name="attendeeEmail" type="email" required maxLength={254} defaultValue={current.lead.email} disabled={pending} className={inputClasses}/></label>
        <label className={labelClasses}>Appointment notes<textarea name="notes" maxLength={1000} disabled={pending} className={`${inputClasses} min-h-20`}/></label>
      </>}
      {slot && <p className="rounded-lg bg-surface-muted p-3 text-sm">Confirm {formatMeetingTime(slot,model.timezone)} with {current.lead.name} before saving.{mode==="reschedule"?" The current time stays reserved until this change succeeds.":""}</p>}
      <button disabled={pending||!slot} className={primaryButtonClasses}>{pending?"Saving…":mode==="reschedule"?"Confirm new time":"Confirm virtual booking"}</button>
    </form>}
  </div>;
}
