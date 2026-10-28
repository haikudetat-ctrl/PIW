import type {QueueSnapshot} from "@/modules/setter-queue/schema";
export const setterTaskId="b5000000-0000-4000-8000-000000000001";
export const setterClaimToken="b5000000-0000-4000-8000-000000000002";
export function setterQueueFixture():QueueSnapshot {
  return {enabled:true,is_manager:false,is_setter:true,timezone:"America/New_York",on_shift_until:"2026-10-28T00:00:00Z",
    buckets:{call_request:1,scheduled_callback:2,new_lead:3,handoff:0,follow_up:4},members:[],
    current:{id:setterTaskId,claim_token:setterClaimToken,title:"Contact new virtual inspection lead",description:null,due_at:"2026-10-27T16:00:00Z",
      claim_expires_at:"2026-10-28T00:00:00Z",attempted_at:null,current_claim_attempted:false,queue_bucket:"new_lead",
      lead:{id:"b5000000-0000-4000-8000-000000000003",name:"Dana Rivera",phone:"+16095550101",email:"dana@example.com",address:"1 Test Lane",source:"ActiveProspect",stage:"new"},
      estimate:{roof_squares:22,range_low_cents:1100000,range_high_cents:1400000,status:"complete"},
      messages:[{direction:"inbound",body:"Please call after school drop-off",status:"received",created_at:"2026-10-27T15:00:00Z"}],attempts:[],outcomes:[],appointments:[]},
  };
}
