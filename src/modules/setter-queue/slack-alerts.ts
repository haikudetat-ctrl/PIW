import "server-only";
import {z} from "zod";

const clientSchema=z.object({
  companyId:z.uuid(),
  webhookUrl:z.url().refine(value=>{
    const url=new URL(value);
    return url.protocol==="https:" && url.hostname==="hooks.slack.com" && url.port==="" && !url.username && !url.password
      && url.pathname.startsWith("/services/") && !url.search && !url.hash;
  }),
}).strict();
export type SetterSlackClient=z.infer<typeof clientSchema>;

export function resolveSetterSlackClients(environment:{SETTER_SLACK_CLIENTS_JSON?:string}):SetterSlackClient[] {
  try {
    if(!environment.SETTER_SLACK_CLIENTS_JSON) return [];
    const result=z.array(clientSchema).max(20).safeParse(JSON.parse(environment.SETTER_SLACK_CLIENTS_JSON));
    if(!result.success || new Set(result.data.map(c=>c.companyId)).size!==result.data.length
      || new Set(result.data.map(c=>c.webhookUrl)).size!==result.data.length) return [];
    return result.data;
  } catch {return [];}
}

export type CallbackAlert={id:string;company_id:string;stage:string;due_at:string;claim_token:string};
export interface CallbackAlertRepository {
  claim(companyId:string):Promise<CallbackAlert[]>;
  settle(alert:CallbackAlert,status:"sent"|"failed"|"uncertain"):Promise<void>;
}

export async function deliverSetterCallbackAlerts({clients,repository,fetchImpl=fetch}:{
  clients:SetterSlackClient[];repository:CallbackAlertRepository;fetchImpl?:typeof fetch;
}) {
  const counts={sent:0,failed:0,uncertain:0};
  for(const client of clients) {
    const alerts=await repository.claim(client.companyId);
    for(const alert of alerts) {
      let status:"sent"|"failed"|"uncertain"="failed";
      if(alert.company_id===client.companyId) {
        try {
          const response=await fetchImpl(client.webhookUrl,{
            method:"POST",headers:{"Content-Type":"application/json"},redirect:"error",signal:AbortSignal.timeout(5000),
            body:JSON.stringify({text:`${alert.stage==="missed"?"Callback window missed; human recovery queued":"Callback needs coverage"}. Due ${alert.due_at}. Open the PIW setter queue. Alert ${alert.id}.`}),
          });
          status=response.ok?"sent":"failed";
        } catch {status="uncertain";}
      }
      // A settlement failure leaves the durable sending state intact. The
      // next sweep marks its expired lease uncertain, never blindly re-sends.
      await repository.settle(alert,status);
      counts[status]++;
    }
  }
  return counts;
}
