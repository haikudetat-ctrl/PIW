import "server-only";
import {inngest} from "@/inngest/client";
import {createServiceClient} from "@/lib/supabase/service";
import {configuredSmsCompanyIds} from "@/modules/sms/client-config";
import {processApprovedSmsDelivery} from "@/modules/sms/approved-delivery";
import {createApprovedSmsDependencies} from "@/modules/sms/approved-runtime";

export const approvedSmsWorker=inngest.createFunction(
 {id:"approved-booking-sms",triggers:{cron:"* * * * *"},concurrency:1,retries:2},
 async({step})=>{
   await step.run("expire-and-mark-unknown",async()=>{
     const {error}=await createServiceClient().rpc("sweep_approved_sms_deliveries");
     if(error)throw new Error("SMS maintenance unavailable");
   });
   const deadline=Date.now()+200_000;
   const ids=configuredSmsCompanyIds();
   // Rotate a bounded group so a large registry cannot overrun a function or
   // starve clients later in the list. Each client gets at most five jobs/run.
   const offset=ids.length?Math.floor(Date.now()/60000)*20%ids.length:0;
   const companies=Array.from({length:Math.min(ids.length,20)},(_,i)=>ids[(offset+i)%ids.length]);
   for(const companyId of companies){
   if(Date.now()>deadline)break;
   await step.run(`deliver-${companyId}`,async()=>{
     const d=createApprovedSmsDependencies();const outcomes:Record<string,number>={};
     for(let i=0;i<5&&Date.now()<deadline;i++){
       const result=await processApprovedSmsDelivery({companyId},d);
       outcomes[result.outcome]=(outcomes[result.outcome]??0)+1;
       if(["idle","disabled"].includes(result.outcome))break;
     }
     return outcomes;
   });}
   return {outcome:"processed",companies:companies.length};
 },
);
