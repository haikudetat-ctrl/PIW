"use client";

import {useEffect,useId,useRef,useState,useTransition,type FormEvent} from "react";
import {inputClasses,labelClasses,primaryButtonClasses,secondaryButtonClasses} from "@/components/ui/form";
import {Icon} from "@/components/ui/icons";
import {formatClockTime,formatMeetingTime,formatMeetingTimeShort,timeZoneAbbreviation} from "@/modules/booking/booking-format";
import type {BookingSummary} from "@/modules/booking/booking-service";
import type {SetterBookingAvailability} from "@/modules/booking/setter-booking-runtime";
import type {QueueSnapshot} from "@/modules/setter-queue/schema";
import {runSetterBookingAction,type SetterBookingResult} from "./booking-actions";

type Current=NonNullable<QueueSnapshot["current"]>;
const weekdayLabel=new Intl.DateTimeFormat("en-US",{timeZone:"UTC",weekday:"short"});
const monthDayLabel=new Intl.DateTimeFormat("en-US",{timeZone:"UTC",month:"short",day:"numeric"});

/**
 * The center of the cockpit: every call is aimed at a booked virtual
 * inspection, so real availability loads as soon as a lead is claimed and a
 * time is one click away.
 */
export function VirtualBooking({current,onBooked}:{current:Current;onBooked:(booking:BookingSummary)=>void}) {
  const id=useId();
  const [pending,startTransition]=useTransition();
  const [availability,setAvailability]=useState<SetterBookingAvailability|null>(null);
  const [result,setResult]=useState<SetterBookingResult|null>(null);
  const [saved,setSaved]=useState<BookingSummary|null>(null);
  const [bookingTimezone,setBookingTimezone]=useState("UTC");
  const [mode,setMode]=useState<"book"|"reschedule"|null>(null);
  const [date,setDate]=useState("");
  const [slot,setSlot]=useState("");
  const [email,setEmail]=useState(current.lead.email);
  const [lostClaim,setLostClaim]=useState(false);
  const loaded=useRef(false);
  const model=availability?.model;
  const timezone=model?.timezone??bookingTimezone;
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
      // State set after an await is not part of the outer transition. Without
      // this wrapper the times render while `pending` is still true, so every
      // time button is briefly disabled and a fast click is dropped.
      startTransition(()=>{
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
        if(next.ok && next.booking) {setSaved(next.booking);setAvailability(null);setMode(null);setSlot("");onBooked(next.booking);}
      });
    });
  }
  function refresh() {run(claimForm("load"));}
  // Load real times the moment the lead is claimed; the setter should never
  // have to ask for them. The ref keeps React's dev double-mount to one call.
  useEffect(()=>{
    if(loaded.current) return;
    loaded.current=true;
    refresh();
  // eslint-disable-next-line react-hooks/exhaustive-deps -- once per claim; the parent remounts on a new claim token
  },[]);

  function save(event:FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if(!slot || !mode) return;
    const fields=new FormData(event.currentTarget);
    const form=claimForm(mode);form.set("startsAt",slot);
    if(mode==="reschedule") {
      if(!model?.booking || !availability?.revision) return;
      form.set("appointmentId",model.booking.appointmentId);form.set("revision",String(availability.revision));
    } else {
      form.set("attendeeEmail",email);form.set("notes",String(fields.get("notes")??""));
    }
    run(form);
  }

  const loadingFirstTimes=pending&&!availability&&!booking;
  const canPick=!!model && !!availability?.calendarAvailable && days.length>0 && !!mode;

  return <section aria-labelledby={`${id}-title`} className="flex flex-col gap-4">
    <div className="flex items-start justify-between gap-3">
      <div>
        <h2 id={`${id}-title`} className="text-lg font-semibold tracking-tight">Book the virtual inspection</h2>
        <p className="mt-0.5 text-sm text-ink-subtle">
          {model?`${model.durationMinutes}-minute video call · times in ${timeZoneAbbreviation(new Date(),model.timezone)}`:"Video call with a roofing specialist"}
        </p>
      </div>
      <button type="button" disabled={pending||lostClaim} className={secondaryButtonClasses} onClick={refresh}>
        {pending?"Checking…":availability||booking?"Refresh times":"Load available times"}
      </button>
    </div>

    {result && (result.ok
      ?(result.booking && <p role="status" className="rounded-lg bg-success-bg p-3 text-sm font-medium text-success">{result.message}</p>)
      :<p role="alert" className="rounded-lg bg-danger-bg p-3 text-sm text-danger">{result.message}</p>)}
    {lostClaim && <p className="text-sm text-ink-subtle">Refresh the queue to continue.</p>}

    {booking && <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-success/30 bg-success-bg p-4">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-success">Booked</p>
        <p className="mt-1 font-semibold text-ink">{formatMeetingTime(booking.startsAt,timezone)}</p>
        <p className="mt-0.5 text-sm text-ink-muted">Invite: {booking.inviteEmail??"homeowner email"} · {booking.durationMinutes} minutes</p>
      </div>
      {model?.booking?.canChange && availability?.revision && mode!=="reschedule" && <button type="button" disabled={pending||!days.length} className={secondaryButtonClasses} onClick={()=>{setMode("reschedule");setSlot("");}}>Move inspection</button>}
    </div>}

    {loadingFirstTimes && <div aria-hidden className="grid grid-cols-4 gap-2">{Array.from({length:8},(_,i)=><div key={i} className="h-10 animate-pulse rounded-lg bg-surface-muted"/>)}</div>}
    {availability?.calendarAvailable===false && result?.ok!==false && <p role="alert" className="rounded-lg bg-warning-bg p-3 text-sm text-warning">Calendar availability couldn&apos;t be checked. Any existing inspection keeps its time. Refresh times to try again.</p>}
    {model && availability?.calendarAvailable && !days.length && <p className="rounded-lg bg-warning-bg p-3 text-sm text-warning">No times are available. Offer a callback and tell your manager capacity is full.</p>}

    {canPick && <form onSubmit={save} className="flex flex-col gap-4">
      <div role="group" aria-label="Inspection day" className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
        {days.map(day=><button key={day.date} type="button" aria-pressed={day.date===date} disabled={pending}
          onClick={()=>{setDate(day.date);setSlot("");}}
          className={`min-w-16 flex-1 whitespace-nowrap rounded-lg border px-2 py-1.5 text-center text-sm transition ${day.date===date?"border-accent bg-accent text-white":"border-border-strong bg-surface text-ink hover:bg-fill-hover"}`}>
          <span className={`block text-xs ${day.date===date?"text-white/80":"text-ink-subtle"}`}>{weekdayLabel.format(new Date(`${day.date}T12:00:00Z`))}</span>
          <span className="block font-semibold">{monthDayLabel.format(new Date(`${day.date}T12:00:00Z`))}</span>
          <span className={`block text-xs ${day.date===date?"text-white/80":"text-ink-subtle"}`}>{day.slots.length} open</span>
        </button>)}
      </div>
      <div role="group" aria-label={`Inspection time (${model.timezone})`} className="grid grid-cols-3 gap-2 sm:grid-cols-4 xl:grid-cols-5">
        {selectedDay?.slots.map(s=><button key={s.startsAt} type="button" aria-pressed={s.startsAt===slot} disabled={pending}
          onClick={()=>setSlot(s.startsAt)}
          className={`rounded-lg border px-2 py-2.5 text-sm font-medium tabular-nums transition ${s.startsAt===slot?"border-accent bg-fill-selected text-accent ring-1 ring-accent":"border-border-strong bg-surface text-ink hover:bg-fill-hover"}`}>
          {formatClockTime(s.startsAt,model.timezone)}
        </button>)}
      </div>

      {mode==="book" && <div className="grid gap-3 sm:grid-cols-2">
        <label className={labelClasses}>Invite email<input name="attendeeEmail" type="email" required maxLength={254} value={email} onChange={e=>setEmail(e.target.value)} disabled={pending} className={inputClasses}/></label>
        <label className={labelClasses}>Appointment notes<textarea name="notes" maxLength={1000} rows={1} disabled={pending} placeholder="Other phone, best time to reach" className={`${inputClasses} min-h-[38px] resize-y`}/></label>
      </div>}

      {mode==="book" && <ol aria-label="Before you book" className="space-y-1.5 rounded-lg bg-surface-muted p-3 text-sm text-ink-muted">
        <li className="flex gap-2"><Icon name="check" className="mt-0.5 shrink-0 text-ink-subtle"/><span>Verify the address: <span className="font-medium text-ink">{current.lead.address}</span></span></li>
        <li className="flex gap-2"><Icon name="check" className="mt-0.5 shrink-0 text-ink-subtle"/><span>Ask for another phone number and add it to the notes</span></li>
        <li className="flex gap-2"><Icon name="check" className="mt-0.5 shrink-0 text-ink-subtle"/><span>Tell them the video invite is going to <span className="font-medium text-ink">{email||"their email"}</span></span></li>
      </ol>}

      {mode==="reschedule" && slot && <p className="text-sm text-ink-subtle">The current time stays reserved until this change succeeds.</p>}
      <button disabled={pending||!slot} className={`${primaryButtonClasses} w-full py-2.5 text-sm`}>
        {pending&&slot?"Saving…":!slot?"Pick a time":mode==="reschedule"?`Move to ${formatMeetingTimeShort(slot,model.timezone)}`:`Book ${formatMeetingTimeShort(slot,model.timezone)}`}
      </button>
    </form>}
  </section>;
}
