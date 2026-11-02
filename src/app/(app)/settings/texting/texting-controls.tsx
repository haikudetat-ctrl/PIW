"use client";
import {useState,useTransition,type FormEvent} from "react";
import {useRouter} from "next/navigation";
import {Card} from "@/components/ui/card";
import {inputClasses,labelClasses,primaryButtonClasses,secondaryButtonClasses} from "@/components/ui/form";
import {SMS_KINDS,SMS_KIND_LABELS,type SmsControlPanel,type SmsKind} from "@/modules/sms/approved-schema";
import {SMS_DRAFT_SUGGESTIONS} from "@/modules/sms/approved-templates";
import {DELIVERY_LABELS,smsReason} from "@/modules/sms/delivery-labels";
import {runTextingSettingsAction,type TextingActionResult} from "./actions";

export function TextingControls({panel,ready,automationRunning}:{panel:SmsControlPanel;ready:boolean;automationRunning:boolean}){
 const router=useRouter(),[pending,start]=useTransition(),[result,setResult]=useState<TextingActionResult|null>(null);
 const [kind,setKind]=useState<SmsKind>("first_touch"),[body,setBody]=useState(SMS_DRAFT_SUGGESTIONS.first_touch);
 function run(f:FormData){start(async()=>{try{const next=await runTextingSettingsAction(f);setResult(next);if(next.ok)router.refresh();}catch{setResult({ok:false,message:"Could not save. Reload to check the current state."});}});}
 function submit(e:FormEvent<HTMLFormElement>){e.preventDefault();const f=new FormData(e.currentTarget);if(f.get("action")==="settings")f.set("enabled",e.currentTarget.querySelector<HTMLInputElement>('input[type="checkbox"]')?.checked?"true":"false");run(f);}
 function versionAction(action:string,id:string){const f=new FormData();f.set("action",action);f.set("id",id);run(f);}
 const approved=panel.templates.filter(t=>t.status==="approved");
 const complete=SMS_KINDS.slice(2).every(k=>approved.some(t=>t.kind===k));
 return <main className="flex min-w-0 flex-col gap-5">
 <div><h2 className="text-[28px] font-bold tracking-tight text-ink">Texting</h2><p className="text-sm text-ink-muted">Approved wording and appointment follow-up for {panel.company_name}.</p></div>
 {result&&<p role={result.ok?"status":"alert"} className="rounded-lg border border-border bg-surface p-3 text-sm">{result.message}</p>}
 <Card title="Appointment texts">
 <p className="text-sm">{ready&&panel.sender_ready?"Company sender connected":"Sender setup incomplete — contact 2Stack"} · {automationRunning?"Automatic delivery available":"Automatic delivery paused by 2Stack"}</p>
 <p className="mt-2 text-sm text-ink-muted">Confirmation after booking or rescheduling, then day-before and hour-before reminders when there is enough notice. New bookings only; existing appointments are not backfilled. Replies pause automatic texts for that phone.</p>
 <form onSubmit={submit} className="mt-4 flex flex-col items-start gap-3"><input type="hidden" name="action" value="settings"/>
 <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="enabled" value="true" defaultChecked={panel.settings.enabled} disabled={!panel.settings.enabled&&(!ready||!panel.sender_ready||!complete)}/>Enable appointment texts for this company</label>
 <label className={`w-full max-w-sm ${labelClasses}`}>Contact-hours timezone<input name="timezone" required defaultValue={panel.settings.timezone} className={inputClasses}/></label>
 <p className="text-xs text-ink-muted">Use an IANA timezone, such as America/New_York. Appointment times use the booking timezone.</p>
 {!complete&&<p className="text-sm text-warning">Approve all four appointment templates before enabling.</p>}
 <button disabled={pending} className={primaryButtonClasses}>Save appointment settings</button></form>
 </Card>
 <Card title="Approved wording">
 <p className="mb-3 text-sm text-ink-muted">Approving a version retires its previous approved version. Saved and approved text cannot be edited. Save a new draft to change it.</p>
 <div className="divide-y divide-border">{SMS_KINDS.map(k=>{const versions=panel.templates.filter(t=>t.kind===k);return <section key={k} className="py-3"><h3 className="text-sm font-semibold">{SMS_KIND_LABELS[k]}</h3>{!versions.length?<p className="mt-1 text-sm text-ink-subtle">No versions yet</p>:versions.slice(0,4).map(t=><div key={t.id} className="mt-2 rounded-lg border border-border p-3"><div className="flex flex-wrap items-center justify-between gap-2"><p className="text-xs font-medium">Version {t.version} · {t.status}</p><div className="flex gap-2">{t.status==="draft"&&<button disabled={pending} className={secondaryButtonClasses} onClick={()=>versionAction("approve",t.id)}>Approve {SMS_KIND_LABELS[k]} v{t.version}</button>}{t.status!=="retired"&&<button disabled={pending} className="text-sm text-danger" onClick={()=>versionAction("retire",t.id)}>Retire v{t.version}</button>}</div></div><p className="mt-2 whitespace-pre-wrap break-words text-sm">{t.body}</p></div>)}</section>;})}</div>
 <form onSubmit={submit} className="mt-5 space-y-3 border-t border-border pt-4"><input type="hidden" name="action" value="draft"/>
 <label className={`block ${labelClasses}`}>New draft kind<select name="kind" value={kind} className={inputClasses} onChange={e=>{const value=e.target.value as SmsKind;setKind(value);setBody(SMS_DRAFT_SUGGESTIONS[value]);}}>{SMS_KINDS.map(k=><option key={k} value={k}>{SMS_KIND_LABELS[k]}</option>)}</select></label>
 <label className={`block ${labelClasses}`}>Exact wording<textarea name="body" value={body} required maxLength={1600} rows={5} onChange={e=>setBody(e.target.value)} className={inputClasses}/></label>
 <p className="text-xs text-ink-muted">Use {"{first_name}"} and {"{company_name}"}. Appointment texts also require {"{booking_time}"} and {"{booking_link}"}. Include Reply STOP. Suggestions need your review and approval.</p>
 <button disabled={pending} className={primaryButtonClasses}>Save new draft</button></form>
 </Card>
 <Card title="Recent deliveries"><p className="mb-3 text-sm text-ink-muted">Accepted means Twilio received the request. Recipient delivery is shown separately. Unknown sends require a log check; PIW never retries them automatically.</p>
 {!panel.deliveries.length?<p className="text-sm text-ink-subtle">No approved texts requested yet.</p>:<ul className="divide-y divide-border">{panel.deliveries.map(d=><li key={d.id} className="py-4"><p className="text-sm font-semibold">{d.lead_name??"Lead"} · {SMS_KIND_LABELS[d.kind]}</p><p className="mt-1 text-sm">{DELIVERY_LABELS[d.status]??d.status}{d.message_status?` · Message: ${d.message_status}`:""}</p><p className="text-xs text-ink-muted">{new Date(d.created_at).toLocaleString("en-US",{timeZone:panel.settings.timezone})} · {d.source}{d.appointment_revision?` · Appointment revision ${d.appointment_revision}`:""}</p>{d.reason&&<p className="mt-1 text-sm text-ink-muted">{smsReason(d.reason)}</p>}
 {d.status==="unknown"&&<form onSubmit={submit} className="mt-3 space-y-3 rounded-lg bg-surface-muted p-3"><input type="hidden" name="action" value="resolve"/><input type="hidden" name="id" value={d.id}/>
 <label className={`block ${labelClasses}`}>Verified outcome<select name="resolution" className={inputClasses}><option value="accepted">Twilio accepted this message</option><option value="not_sent">Confirmed no request was accepted</option></select></label>
 <label className={`block ${labelClasses}`}>Twilio message SID (required if accepted)<input name="sid" maxLength={34} placeholder="SM…" className={inputClasses}/></label>
 <label className={`block ${labelClasses}`}>Evidence from Twilio logs<textarea name="note" required minLength={10} maxLength={2000} className={inputClasses}/></label>
 <label className="flex items-start gap-2 text-sm"><input type="checkbox" name="verified" value="true" required/>I checked this client&apos;s Twilio logs and verified this exact attempt.</label>
 <button className={secondaryButtonClasses} disabled={pending}>Record verified outcome</button><p className="text-xs text-ink-muted">Records your attestation in the audit log. Does not resend.</p></form>}
 </li>)}</ul>}</Card>
 <Card title="Paused phones"><p className="mb-3 text-sm text-ink-muted">A resume applies to future eligible texts. Previously skipped messages stay closed. STOP and consent checks still apply.</p>{!panel.pauses.length?<p className="text-sm text-ink-subtle">No phones paused.</p>:<ul className="divide-y divide-border">{panel.pauses.map(p=><li key={p.phone_e164} className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm"><span>{p.phone_e164} · {p.reason}</span><form onSubmit={submit}><input type="hidden" name="action" value="resume"/><input type="hidden" name="phone" value={p.phone_e164}/><button disabled={pending} className={secondaryButtonClasses}>Resume future texts</button></form></li>)}</ul>}</Card>
 </main>;
}
