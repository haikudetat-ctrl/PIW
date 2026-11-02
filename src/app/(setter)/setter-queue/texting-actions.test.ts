// @vitest-environment node
import {beforeEach,expect,test,vi} from "vitest";
const {rpc,processDelivery}=vi.hoisted(()=>({rpc:vi.fn(),processDelivery:vi.fn()}));
vi.mock("@/lib/supabase/server",()=>({createServerClient:async()=>({auth:{getUser:async()=>({data:{user:{id:"setter"}}})},rpc})}));
vi.mock("next/cache",()=>({revalidatePath:vi.fn()}));
vi.mock("@/modules/sms/approved-runtime",()=>({approvedSmsReady:()=>true,createApprovedSmsDependencies:()=>({})}));
vi.mock("@/modules/sms/approved-delivery",()=>({processApprovedSmsDelivery:processDelivery}));
import {runSetterTextingAction} from "./texting-actions";
const id="c1000000-0000-4000-8000-000000000301",token="c1000000-0000-4000-8000-000000000601",templateId="c1000000-0000-4000-8000-000000000701";
function form(extra:Record<string,string>){const f=new FormData();for(const[k,v]of Object.entries({taskId:id,token,...extra}))f.set(k,v);return f;}
const context={company_id:"c1000000-0000-4000-8000-000000000001",company_name:"Client",phone:"+16095550101",paused:false,templates:[{id:templateId,kind:"first_touch",version:1,body:"Hi {first_name}, {company_name}. Reply STOP."}],delivery:null};
beforeEach(()=>{rpc.mockReset().mockImplementation(async(name:string)=>({error:null,data:name==="get_setter_texting_context"?context:"c1000000-0000-4000-8000-000000000501"}));processDelivery.mockReset().mockResolvedValue({outcome:"accepted"});});
test("send accepts claim plus template ID only and derives the company from the claim RPC",async()=>{
 expect((await runSetterTextingAction(form({action:"send",templateId}))).ok).toBe(true);
 expect(rpc).toHaveBeenCalledWith("queue_setter_template_sms",{p_task_id:id,p_claim_token:token,p_template_id:templateId});
 expect(processDelivery).toHaveBeenCalledWith({companyId:context.company_id,deliveryId:"c1000000-0000-4000-8000-000000000501"},{});
});
test("forged body or company cannot reach the send RPC",async()=>{
 expect((await runSetterTextingAction(form({action:"send",templateId,body:"Forged"}))).ok).toBe(false);
 expect(rpc).not.toHaveBeenCalled();expect(processDelivery).not.toHaveBeenCalled();
});
test("lost claim cannot enqueue or send",async()=>{
 rpc.mockResolvedValue({data:null,error:{code:"42501"}});
 expect((await runSetterTextingAction(form({action:"send",templateId}))).ok).toBe(false);
 expect(processDelivery).not.toHaveBeenCalled();
});
test("an unknown outcome is shown as requiring verification",async()=>{
 processDelivery.mockResolvedValue({outcome:"unknown"});
 expect((await runSetterTextingAction(form({action:"send",templateId}))).message).toMatch(/verification/i);
});
