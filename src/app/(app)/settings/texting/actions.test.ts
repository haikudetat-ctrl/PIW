// @vitest-environment node
import {beforeEach,expect,test,vi} from "vitest";
const rpc=vi.hoisted(()=>vi.fn());
vi.mock("@/lib/supabase/server",()=>({createServerClient:async()=>({auth:{getUser:async()=>({data:{user:{id:"actor"}}})},rpc})}));
vi.mock("next/cache",()=>({revalidatePath:vi.fn()}));
vi.mock("@/modules/sms/approved-runtime",()=>({approvedSmsReady:()=>false}));
import {runTextingSettingsAction} from "./actions";
const company="c1000000-0000-4000-8000-000000000001";
const id="c1000000-0000-4000-8000-000000000701";
function form(fields:Record<string,string>){const f=new FormData();for(const [k,v]of Object.entries(fields))f.set(k,v);return f;}
beforeEach(()=>{rpc.mockReset().mockImplementation(async(name:string)=>name==="get_my_access"?{data:[{user_id:"actor",company_id:company,display_name:"Admin",role:"company_admin",is_platform_admin:false}],error:null}:{data:null,error:null});});
test("template approval sends only a validated version ID through the member RPC",async()=>{
 expect((await runTextingSettingsAction(form({action:"approve",id}))).ok).toBe(true);
 expect(rpc).toHaveBeenCalledWith("approve_sms_template",{p_template_id:id});
});
test("rejects company overrides and non-admin direct action calls",async()=>{
 expect((await runTextingSettingsAction(form({action:"approve",id,companyId:company}))).ok).toBe(false);
 expect(rpc).not.toHaveBeenCalledWith("approve_sms_template",expect.anything());
 rpc.mockResolvedValue({data:[{user_id:"actor",company_id:company,display_name:"Setter",role:"employee",is_platform_admin:false}]});
 expect((await runTextingSettingsAction(form({action:"approve",id}))).ok).toBe(false);
});
test("automatic enablement is blocked until this company transport is ready",async()=>{
 expect((await runTextingSettingsAction(form({action:"settings",enabled:"true",timezone:"America/New_York"}))).ok).toBe(false);
 expect(rpc).not.toHaveBeenCalledWith("save_sms_automation_settings",expect.anything());
});
test("unknown reconciliation requires an explicit log verification attestation",async()=>{
 expect((await runTextingSettingsAction(form({action:"resolve",id,resolution:"not_sent",note:"Checked Twilio request logs",sid:""}))).ok).toBe(false);
 expect(rpc).not.toHaveBeenCalledWith("resolve_sms_delivery",expect.anything());
 expect((await runTextingSettingsAction(form({action:"resolve",id,resolution:"not_sent",note:"Checked Twilio request logs",sid:"",verified:"true"}))).ok).toBe(true);
 expect(rpc).toHaveBeenCalledWith("resolve_sms_delivery",{p_id:id,p_resolution:"not_sent",p_provider_sid:"",p_note:"Checked Twilio request logs"});
});
