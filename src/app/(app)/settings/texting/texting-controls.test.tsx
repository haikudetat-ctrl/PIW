import {fireEvent,render,screen,waitFor} from "@testing-library/react";
import {beforeEach,expect,test,vi} from "vitest";
import type {SmsControlPanel} from "@/modules/sms/approved-schema";
const action=vi.hoisted(()=>vi.fn());
vi.mock("./actions",()=>({runTextingSettingsAction:action}));
vi.mock("next/navigation",()=>({useRouter:()=>({refresh:vi.fn()})}));
import {TextingControls} from "./texting-controls";
const panel:SmsControlPanel={company_id:"c1000000-0000-4000-8000-000000000001",company_name:"AllSeason",settings:{enabled:false,timezone:"America/New_York"},sender_ready:true,templates:[{id:"c1000000-0000-4000-8000-000000000701",kind:"first_touch",version:1,body:"Hi {first_name}, {company_name}. Reply STOP.",status:"draft",created_at:"2026-11-02T15:00:00Z",approved_at:null}],deliveries:[],pauses:[]};
beforeEach(()=>action.mockReset().mockResolvedValue({ok:true,message:"Saved"}));
test("displays exact saved wording and approves its version separately from drafting",async()=>{
 render(<TextingControls panel={panel} ready={true} automationRunning={false}/>);
 expect(screen.getByText(panel.templates[0].body)).toBeInTheDocument();
 fireEvent.click(screen.getByRole("button",{name:"Approve First touch v1"}));
 await waitFor(()=>expect(action).toHaveBeenCalledTimes(1));
 expect(Object.fromEntries(action.mock.calls[0][0])).toEqual({action:"approve",id:panel.templates[0].id});
 expect(screen.getByLabelText("Enable appointment texts for this company")).toBeDisabled();
});
test("disabled company settings serialize false when the checkbox is unchecked",async()=>{
 render(<TextingControls panel={panel} ready={false} automationRunning={false}/>);
 fireEvent.click(screen.getByRole("button",{name:"Save appointment settings"}));
 await waitFor(()=>expect(action).toHaveBeenCalledTimes(1));
 expect(Object.fromEntries(action.mock.calls[0][0])).toEqual({action:"settings",enabled:"false",timezone:"America/New_York"});
});
test("unknown delivery exposes verification and never offers resend",()=>{
 const p={...panel,deliveries:[{id:"c1000000-0000-4000-8000-000000000501",kind:"reminder_hour" as const,source:"automatic",status:"unknown",reason:"acceptance_unknown",created_at:"2026-11-02T15:00:00Z",not_before:"2026-11-02T15:00:00Z",expires_at:"2026-11-02T16:00:00Z",appointment_revision:1,message_status:"unknown",provider_sid:null,lead_name:"Dana"}]};
 render(<TextingControls panel={p} ready={true} automationRunning={false}/>);
 expect(screen.getByText(/Needs verification/)).toBeInTheDocument();
 expect(screen.getByLabelText(/I checked this client's Twilio logs/)).toBeRequired();
 expect(screen.queryByRole("button",{name:/resend/i})).not.toBeInTheDocument();
});
