import "server-only";
import {inngest} from "@/inngest/client";
import {createServiceClient} from "@/lib/supabase/service";
import {deliverSetterCallbackAlerts,resolveSetterSlackClients,type CallbackAlertRepository} from "@/modules/setter-queue/slack-alerts";

export const setterCallbackSla=inngest.createFunction(
  {id:"setter-callback-sla",name:"Setter callback coverage and recovery",triggers:{cron:"* * * * *"},concurrency:{limit:1},retries:2},
  async({step})=>{
    if(process.env.SETTER_CALLBACK_SLA_ENABLED!=="true") return {enabled:false};
    const stages=await step.run("sweep-callback-windows",async()=>{
      const {data,error}=await createServiceClient().rpc("sweep_setter_callback_sla");
      if(error) throw new Error("Callback SLA sweep failed");
      return data;
    });
    // Without a client binding, in-app notifications still work and Slack
    // stays queued. Each tenant has its own bounded, durable workflow step.
    for(const client of resolveSetterSlackClients({SETTER_SLACK_CLIENTS_JSON:process.env.SETTER_SLACK_CLIENTS_JSON})) {
      await step.run(`deliver-callback-alerts-${client.companyId}`,async()=>{
        const db=createServiceClient();
        const repository:CallbackAlertRepository={
          async claim(companyId) {
            const {data,error}=await db.rpc("claim_setter_callback_alerts",{p_company_id:companyId});
            if(error) throw new Error("Callback alert claim failed");
            return data??[];
          },
          async settle(alert,status) {
            const {error}=await db.rpc("settle_setter_callback_alert",{p_id:alert.id,p_claim_token:alert.claim_token,p_status:status});
            if(error) throw new Error("Callback alert settlement failed");
          },
        };
        return deliverSetterCallbackAlerts({clients:[client],repository});
      });
    }
    return {enabled:true,stages};
  },
);
