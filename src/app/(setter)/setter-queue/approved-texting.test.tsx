import {fireEvent,render,screen,waitFor} from "@testing-library/react";
import {beforeEach,expect,test,vi} from "vitest";
import {setterQueueFixture} from "@/test/setter-queue-fixture";
const action=vi.hoisted(()=>vi.fn());
vi.mock("./texting-actions",()=>({runSetterTextingAction:action}));
import {ApprovedTexting} from "./approved-texting";
const context={company_id:"c1000000-0000-4000-8000-000000000001",company_name:"AllSeason",phone:"+16095550101",paused:false,templates:[{id:"c1000000-0000-4000-8000-000000000701",kind:"first_touch",version:1,body:"Hi {first_name}, {company_name}. Reply STOP."}],delivery:null};
beforeEach(()=>{action.mockReset().mockResolvedValue({ok:true,message:"Loaded",context,ready:true});});
test("previews approved wording and sends template ID without a body",async()=>{
 render(<ApprovedTexting current={setterQueueFixture().current!}/>);
 fireEvent.click(screen.getByRole("button",{name:"Load approved texts"}));
 expect(await screen.findByText(/Hi Dana, AllSeason. Reply STOP./)).toBeInTheDocument();
 fireEvent.click(screen.getByRole("button",{name:"Send approved text"}));
 await waitFor(()=>expect(action).toHaveBeenCalledTimes(2));
 expect(Object.fromEntries(action.mock.calls[1][0])).toMatchObject({action:"send",templateId:context.templates[0].id});
 expect(action.mock.calls[1][0].has("body")).toBe(false);
});
test("unknown acceptance disables another send and exposes verification",async()=>{
 action.mockResolvedValue({ok:true,message:"Loaded",ready:true,context:{...context,delivery:{id:"c1000000-0000-4000-8000-000000000501",status:"unknown",reason:"acceptance_unknown",template_id:context.templates[0].id}}});
 render(<ApprovedTexting current={setterQueueFixture().current!}/>);
 fireEvent.click(screen.getByRole("button",{name:"Load approved texts"}));
 expect(await screen.findByText(/Needs verification/)).toBeInTheDocument();
 expect(screen.getByRole("button",{name:"Send approved text"})).toBeDisabled();
});
