import {beforeEach,describe,expect,test,vi} from "vitest";
import {setterQueueFixture,setterTaskId,setterClaimToken} from "@/test/setter-queue-fixture";
const state=vi.hoisted(()=>({signedIn:true,queue:{} as unknown,error:null as unknown,mutations:[] as Array<{name:string;args:unknown}>}));
vi.mock("next/cache",()=>({revalidatePath:()=>{}}));
vi.mock("@/lib/supabase/server",()=>({createServerClient:async()=>({
  auth:{getUser:async()=>({data:{user:state.signedIn?{id:"b5000000-0000-4000-8000-000000000101"}:null}})},
  rpc:async(name:string,args:unknown)=>{
    if(name==="get_setter_queue") return {data:state.queue,error:state.error};
    state.mutations.push({name,args}); return {data:null,error:null};
  },
})}));
vi.mock("@/lib/supabase/service",()=>({createServiceClient:()=>{throw new Error("Privileged access must not be reached");}}));
import {runSetterQueueAction} from "./actions";

function form(data:Record<string,string>) {const f=new FormData();for(const [key,value] of Object.entries(data)) f.set(key,value);return f;}
beforeEach(()=>{state.signedIn=true;state.queue=setterQueueFixture();state.error=null;state.mutations=[];});
describe("queue server actions",()=>{
  test("unauthenticated request cannot mutate the queue",async()=>{
    state.signedIn=false;
    expect((await runSetterQueueAction(form({action:"claim"}))).ok).toBe(false);
    expect(state.mutations).toEqual([]);
  });
  test("submits the callback in the live company timezone without accepting a company id",async()=>{
    const result=await runSetterQueueAction(form({action:"outcome",taskId:setterTaskId,token:setterClaimToken,outcome:"callback_scheduled",callbackLocal:"2026-10-28T09:15",notes:"After drop-off"}));
    expect(result.ok).toBe(true);
    expect(state.mutations).toEqual([{name:"finish_setter_task",args:{p_task_id:setterTaskId,p_claim_token:setterClaimToken,p_outcome:"callback_scheduled",p_notes:"After drop-off",p_callback_at:"2026-10-28T13:15:00.000Z",p_appointment_id:undefined}}]);
  });
  test("unclaimed or stale lead cannot mint a privileged booking link",async()=>{
    const fixture=setterQueueFixture();fixture.current=null;state.queue=fixture;
    const result=await runSetterQueueAction(form({action:"booking_link",taskId:setterTaskId,token:setterClaimToken}));
    expect(result).toEqual({ok:false,message:"Claim expired or changed; reload the queue"});
    expect(state.mutations).toEqual([]);
  });
  test("database infrastructure errors stay private",async()=>{
    state.error={message:"private connection details"};
    expect(await runSetterQueueAction(form({action:"claim"}))).toEqual({ok:false,message:"Couldn't update the queue. Reload and try again."});
  });
});
