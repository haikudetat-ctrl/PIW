// Display helpers for the setter cockpit. Pure functions so the panels stay
// declarative and the formatting is testable without rendering.

/** "+16095550101" becomes "(609) 555-0101"; anything else is returned as given. */
export function formatPhone(value:string) {
  const digits=value.replace(/\D/g,"");
  const national=digits.length===11&&digits.startsWith("1")?digits.slice(1):digits;
  if(national.length!==10) return value;
  return `(${national.slice(0,3)}) ${national.slice(3,6)}-${national.slice(6)}`;
}

/** "Tue, Oct 27, 12:00 PM" in the company time zone. */
export function formatWhen(value:string|null,timeZone:string) {
  if(!value) return "—";
  return new Intl.DateTimeFormat("en-US",{timeZone,weekday:"short",month:"short",day:"numeric",hour:"numeric",minute:"2-digit"}).format(new Date(value));
}

/** Whole-unit age such as "4 min", "2 hr" or "3 days" between two instants. */
export function formatAge(fromMs:number,toMs:number) {
  const minutes=Math.max(0,Math.floor((toMs-fromMs)/60_000));
  if(minutes<60) return `${minutes} min`;
  const hours=Math.floor(minutes/60);
  if(hours<48) return `${hours} hr`;
  return `${Math.floor(hours/24)} days`;
}

/** Countdown "m:ss", or "h:mm:ss" past an hour. Never negative. */
export function formatCountdown(ms:number) {
  const total=Math.max(0,Math.floor(ms/1000));
  const h=Math.floor(total/3600),m=Math.floor((total%3600)/60),s=total%60;
  const pad=(n:number)=>String(n).padStart(2,"0");
  return h?`${h}:${pad(m)}:${pad(s)}`:`${m}:${pad(s)}`;
}

export const OUTCOME_LABELS:Record<string,string>={
  booked_virtual:"Booked virtual",booked_in_home:"Booked in-home",callback_scheduled:"Callback scheduled",
  no_answer:"No answer",voicemail:"Left voicemail",not_interested:"Not interested",disqualified:"Disqualified",handoff:"Handed to manager",
};

export const BUCKET_LABELS=[
  ["call_request","Call requests"],["scheduled_callback","Callbacks"],["new_lead","New"],["handoff","Handoffs"],["follow_up","Follow-up"],
] as const;
