import {fireEvent,render,screen,waitFor} from "@testing-library/react";
import {beforeEach,describe,expect,test,vi} from "vitest";
import {setterQueueFixture,setterTaskId,setterClaimToken} from "@/test/setter-queue-fixture";
import type {SetterBookingAvailability} from "@/modules/booking/setter-booking-runtime";
const action=vi.hoisted(()=>vi.fn<(form:FormData)=>Promise<{ok:boolean;message:string}>>().mockResolvedValue({ok:true,message:"Saved"}));
const booking=vi.hoisted(()=>vi.fn());
vi.mock("./actions",()=>({runSetterQueueAction:action}));
vi.mock("./booking-actions",()=>({runSetterBookingAction:booking}));
vi.mock("./texting-actions",()=>({runSetterTextingAction:vi.fn()}));
vi.mock("next/navigation",()=>({useRouter:()=>({refresh:()=>{}})}));
import {QueueWorkspace} from "./queue-workspace";

const appointmentId="b6000000-0000-4000-8000-000000000601";
const summary={appointmentId,startsAt:"2026-11-02T16:00:00.000Z",endsAt:"2026-11-02T16:30:00.000Z",durationMinutes:30,meetingUrl:null,calendarReady:false,inviteEmail:"d•••@example.com",canChange:true};
const availability:SetterBookingAvailability={model:{kind:"open",firstName:"Dana",inviteEmail:"d•••@example.com",supportPhone:null,meetingTitle:"Virtual inspection",durationMinutes:30,timezone:"America/New_York",booking:null,days:[
  {date:"2026-11-02",weekday:1,slots:[{startsAt:"2026-11-02T16:00:00.000Z",minuteOfDay:660}]},
]},revision:null,calendarAvailable:true};
const sent=(i:number)=>Object.fromEntries(action.mock.calls[i][0]);

beforeEach(()=>{
  action.mockClear();
  booking.mockReset().mockResolvedValue({ok:true,message:"Available",availability});
});

describe("setter cockpit",()=>{
  test("shows who to call and keeps lead quality signals away from setters",async()=>{
    render(<QueueWorkspace snapshot={setterQueueFixture()}/>);
    expect(screen.getByRole("heading",{name:"Dana Rivera"})).toBeInTheDocument();
    expect(screen.getAllByText("(609) 555-0101").length).toBeGreaterThan(0);
    expect(screen.getByText("Please call after school drop-off")).toBeInTheDocument();
    expect(screen.queryByText(/ActiveProspect/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Estimate/)).not.toBeInTheDocument();
    expect(screen.queryByRole("list",{name:"Queue"})).not.toBeInTheDocument();
    expect(screen.queryByRole("button",{name:"Claim next lead"})).not.toBeInTheDocument();
    expect(screen.getByRole("radio",{name:"No answer"})).toBeRequired();
    // Booking times load without the setter asking for them.
    expect(await screen.findByRole("button",{name:"11:00 AM"})).toBeInTheDocument();
  });
  test("logs the manual call attempt with the claim token",async()=>{
    render(<QueueWorkspace snapshot={setterQueueFixture()}/>);
    fireEvent.click(screen.getByRole("button",{name:"Log attempt"}));
    await waitFor(()=>expect(action).toHaveBeenCalledTimes(1));
    expect(sent(0)).toEqual({action:"attempt",taskId:setterTaskId,token:setterClaimToken});
    expect(await screen.findByRole("status")).toHaveTextContent("Saved");
  });
  test("a callback saves the wall time in the company zone, then claims the next lead",async()=>{
    render(<QueueWorkspace snapshot={setterQueueFixture()}/>);
    fireEvent.click(screen.getByRole("radio",{name:"Callback"}));
    fireEvent.change(screen.getByLabelText("Callback time (America/New_York)"),{target:{value:"2026-10-28T09:15"}});
    fireEvent.click(screen.getByRole("button",{name:"Save & next lead"}));
    await waitFor(()=>expect(action).toHaveBeenCalledTimes(2));
    expect(sent(0)).toMatchObject({action:"outcome",outcome:"callback_scheduled",callbackLocal:"2026-10-28T09:15",taskId:setterTaskId,token:setterClaimToken});
    expect(sent(1)).toEqual({action:"claim"});
  });
  test("save and take a break does not claim another lead",async()=>{
    render(<QueueWorkspace snapshot={setterQueueFixture()}/>);
    fireEvent.click(screen.getByRole("radio",{name:"No answer"}));
    fireEvent.click(screen.getByRole("button",{name:"Save & take a break"}));
    await waitFor(()=>expect(action).toHaveBeenCalledTimes(1));
    await new Promise(r=>setTimeout(r,0));
    expect(action).toHaveBeenCalledTimes(1);
    expect(sent(0)).toMatchObject({action:"outcome",outcome:"no_answer"});
  });
  test("booking on the call preselects the booked outcome with its appointment",async()=>{
    render(<QueueWorkspace snapshot={setterQueueFixture()}/>);
    fireEvent.click(await screen.findByRole("button",{name:"11:00 AM"}));
    booking.mockResolvedValueOnce({ok:true,message:"Virtual inspection booked.",booking:summary});
    fireEvent.click(screen.getByRole("button",{name:"Book Mon, Nov 2, 11:00 AM"}));
    const booked=await screen.findByRole("radio",{name:"Booked Mon, Nov 2, 11:00 AM"});
    expect(booked).toBeChecked();
    fireEvent.click(screen.getByRole("button",{name:"Save & next lead"}));
    await waitFor(()=>expect(action).toHaveBeenCalledTimes(2));
    expect(sent(0)).toMatchObject({action:"outcome",outcome:"booked_virtual",appointmentId});
  });
  test("a reason is required before disqualifying",()=>{
    render(<QueueWorkspace snapshot={setterQueueFixture()}/>);
    fireEvent.click(screen.getByRole("radio",{name:"Disqualified"}));
    expect(screen.getByLabelText("Reason (required)")).toBeRequired();
  });
  test("idle setters can claim but do not receive unclaimed homeowner details",()=>{
    const snapshot=setterQueueFixture();snapshot.current=null;
    render(<QueueWorkspace snapshot={snapshot}/>);
    expect(screen.getByRole("button",{name:"Claim next lead"})).toBeInTheDocument();
    expect(screen.queryByText("Dana Rivera")).not.toBeInTheDocument();
    expect(screen.queryByRole("link",{name:/Settings/})).not.toBeInTheDocument();
  });
  test("off-shift setters start their shift from the cockpit",async()=>{
    const snapshot=setterQueueFixture();snapshot.current=null;snapshot.on_shift_until=null;
    render(<QueueWorkspace snapshot={snapshot}/>);
    fireEvent.click(screen.getAllByRole("button",{name:"Go on shift"})[0]);
    await waitFor(()=>expect(action).toHaveBeenCalledTimes(1));
    expect(sent(0)).toEqual({action:"shift",onShift:"true"});
  });
  test("recovered claim can log a new call even when the previous setter attempted",()=>{
    const snapshot=setterQueueFixture();
    snapshot.current!.attempted_at="2026-10-27T15:50:00Z";
    render(<QueueWorkspace snapshot={snapshot}/>);
    expect(screen.getByRole("button",{name:"Log attempt"})).toBeEnabled();
  });
  test("managers get queue counts, lead context and the settings page",()=>{
    const snapshot=setterQueueFixture();snapshot.is_manager=true;
    render(<QueueWorkspace snapshot={snapshot}/>);
    expect(screen.getByRole("link",{name:/Settings/})).toHaveAttribute("href","/setter-queue/settings");
    expect(screen.getByText(/ActiveProspect/)).toBeInTheDocument();
    expect(screen.getByText(/Estimate \$11,000–\$14,000/)).toBeInTheDocument();
  });
});
