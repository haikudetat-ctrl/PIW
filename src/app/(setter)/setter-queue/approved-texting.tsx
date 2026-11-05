"use client";
import {useId,useState,useTransition} from "react";
import type {QueueSnapshot} from "@/modules/setter-queue/schema";
import {SMS_KIND_LABELS} from "@/modules/sms/approved-schema";
import {renderApprovedTemplate} from "@/modules/sms/approved-templates";
import {DELIVERY_LABELS,smsReason} from "@/modules/sms/delivery-labels";
import {inputClasses,labelClasses,primaryButtonClasses,secondaryButtonClasses} from "@/components/ui/form";
import {runSetterTextingAction,type SetterTextingResult} from "./texting-actions";
export function ApprovedTexting({current}:{current:NonNullable<QueueSnapshot["current"]>}){
 const id=useId();const [result,setResult]=useState<SetterTextingResult|null>(null),[templateId,setTemplateId]=useState("");const[pending,start]=useTransition();
 const context=result?.context,template=context?.templates.find(t=>t.id===templateId);
 const rendered=template&&context?renderApprovedTemplate(template.body,{first_name:current.lead.name.trim().split(/\s+/)[0]||"there",company_name:context.company_name}):null;
 function run(action:string,extras:Record<string,string>={}){
  const f=new FormData();for(const[k,v]of Object.entries({action,taskId:current.id,token:current.claim_token,...extras}))f.set(k,v);
  start(async()=>{try{const next=await runSetterTextingAction(f);setResult(next);if(next.context&&!next.context.templates.some(t=>t.id===templateId))setTemplateId(next.context.templates[0]?.id??"");}catch{setResult({ok:false,message:"Could not load texting status. Reload before sending."});}});
 }
 return <section aria-label="Approved texting">
  <h3 className="text-sm font-semibold">Approved text</h3><p className="mt-0.5 text-xs text-ink-subtle">One approved text per claim. Still record the call outcome.</p>
  {!context?<button className={`${secondaryButtonClasses} mt-3`} disabled={pending} onClick={()=>run("load")}>Load approved texts</button>:<div className="mt-3 space-y-3">
   {!result?.ready&&<p className="text-sm text-warning">Texting setup is incomplete. Ask your manager.</p>}
   {!context.phone&&<p className="text-sm text-warning">A valid US phone is required.</p>}
   <label className={`block ${labelClasses}`} htmlFor={`${id}-template`}>Approved wording</label>
   <select id={`${id}-template`} value={templateId} onChange={e=>setTemplateId(e.target.value)} disabled={pending||!!context.delivery} className={inputClasses}>
    {!context.templates.length&&<option value="">No approved setter templates</option>}{context.templates.map(t=><option key={t.id} value={t.id}>{SMS_KIND_LABELS[t.kind]} · v{t.version}</option>)}
   </select>
   {rendered?.ok&&<p className="whitespace-pre-wrap rounded-lg bg-surface-muted p-3 text-sm">{rendered.body}</p>}
   {context.delivery&&<p className="text-sm font-medium">{DELIVERY_LABELS[context.delivery.status]??context.delivery.status}{smsReason(context.delivery.reason)?` · ${smsReason(context.delivery.reason)}`:""}</p>}
   {context.delivery?.status==="unknown"&&<p className="text-sm text-warning">Ask a company admin to verify Twilio logs before any follow-up.</p>}
   <button className={primaryButtonClasses} disabled={pending||!result?.ready||!context.phone||!rendered?.ok||!!context.delivery} onClick={()=>run("send",{templateId})}>Send approved text</button>
   <div className="border-t border-border pt-3"><p className="mb-2 text-sm">Automatic texts: {context.paused?"paused for this phone":"following appointment schedule"}. Replies pause them for human follow-up.</p>
   <button disabled={pending||!context.phone} className={secondaryButtonClasses} onClick={()=>run("pause",{paused:context.paused?"false":"true"})}>{context.paused?"Resume future automatic texts":"Pause automatic texts"}</button></div>
  </div>}
  {result&&<p className="mt-3 text-sm" role={result.ok?"status":"alert"}>{result.message}</p>}
 </section>;
}
