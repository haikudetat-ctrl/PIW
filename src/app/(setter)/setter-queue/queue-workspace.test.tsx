import {fireEvent,render,screen,waitFor} from "@testing-library/react";
import {beforeEach,describe,expect,test,vi} from "vitest";
import {setterQueueFixture,setterTaskId,setterClaimToken} from "@/test/setter-queue-fixture";
const action=vi.hoisted(()=>vi.fn<(form:FormData)=>Promise<{ok:boolean;message:string}>>().mockResolvedValue({ok:true,message:"Saved"}));
vi.mock("./actions",()=>({runSetterQueueAction:action}));
vi.mock("next/navigation",()=>({useRouter:()=>({refresh:()=>{}})}));
import {QueueWorkspace} from "./queue-workspace";
beforeEach(()=>action.mockClear());
describe("setter workspace",()=>{
  test("shows claimed context and requires a disposition before another lead",()=>{
    render(<QueueWorkspace snapshot={setterQueueFixture()} report={[]}/>);
    expect(screen.getByRole("heading",{name:"Dana Rivera"})).toBeInTheDocument();
    expect(screen.getByText("Please call after school drop-off")).toBeInTheDocument();
    expect(screen.queryByRole("button",{name:"Claim next lead"})).not.toBeInTheDocument();
    expect(screen.getByLabelText(/Outcome/)).toBeRequired();
  });
  test("records the manual call with the claim token",async()=>{
    render(<QueueWorkspace snapshot={setterQueueFixture()} report={[]}/>);
    fireEvent.click(screen.getByRole("button",{name:"Record call attempt"}));
    await waitFor(()=>expect(action).toHaveBeenCalledTimes(1));
    expect(Object.fromEntries(action.mock.calls[0][0])).toEqual({action:"attempt",taskId:setterTaskId,token:setterClaimToken});
    expect(await screen.findByRole("status")).toHaveTextContent("Saved");
  });
  test("callback form labels the tenant timezone and sends a wall time",async()=>{
    render(<QueueWorkspace snapshot={setterQueueFixture()} report={[]}/>);
    fireEvent.change(screen.getByLabelText(/Outcome/),{target:{value:"callback_scheduled"}});
    fireEvent.change(screen.getByLabelText("Callback time (America/New_York)"),{target:{value:"2026-10-28T09:15"}});
    fireEvent.click(screen.getByRole("button",{name:"Save outcome"}));
    await waitFor(()=>expect(action).toHaveBeenCalledTimes(1));
    expect(action.mock.calls[0][0].get("callbackLocal")).toBe("2026-10-28T09:15");
  });
  test("idle setters can claim but do not receive unclaimed homeowner details",()=>{
    const snapshot=setterQueueFixture();snapshot.current=null;
    render(<QueueWorkspace snapshot={snapshot} report={[]}/>);
    expect(screen.getByRole("button",{name:"Claim next lead"})).toBeInTheDocument();
    expect(screen.queryByText("Dana Rivera")).not.toBeInTheDocument();
    expect(screen.queryByText("Queue settings")).not.toBeInTheDocument();
  });
});
