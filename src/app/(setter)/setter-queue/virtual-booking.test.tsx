import {fireEvent,render,screen,waitFor} from "@testing-library/react";
import {beforeEach,describe,expect,test,vi} from "vitest";
import {setterQueueFixture,setterTaskId,setterClaimToken} from "@/test/setter-queue-fixture";
import type {SetterBookingAvailability} from "@/modules/booking/setter-booking-runtime";
import type {SetterBookingResult} from "./booking-actions";
const action=vi.hoisted(()=>vi.fn<(form:FormData)=>Promise<SetterBookingResult>>());
vi.mock("./booking-actions",()=>({runSetterBookingAction:action}));
import {VirtualBooking} from "./virtual-booking";
const current=setterQueueFixture().current!;
const appointmentId="b6000000-0000-4000-8000-000000000601";
const booking={appointmentId,startsAt:"2026-11-02T15:00:00.000Z",endsAt:"2026-11-02T15:30:00.000Z",durationMinutes:30,meetingUrl:null,calendarReady:false,inviteEmail:"d•••@example.com",canChange:true};
function availability(booked=false):SetterBookingAvailability {
  return {model:{kind:booked?"booked":"open",firstName:"Dana",inviteEmail:"d•••@example.com",supportPhone:null,meetingTitle:"Virtual inspection",durationMinutes:30,timezone:"America/New_York",booking:booked?booking:null,days:[
    {date:"2026-11-02",weekday:1,slots:[{startsAt:"2026-11-02T16:00:00.000Z",minuteOfDay:660},{startsAt:"2026-11-02T17:00:00.000Z",minuteOfDay:720}]},
  ]},revision:booked?3:null,calendarAvailable:true};
}
beforeEach(()=>{action.mockReset().mockResolvedValue({ok:true,message:"Available",availability:availability()});});
describe("setter virtual booking",()=>{
  test("loads real times as soon as the lead is claimed, then books with the confirmed email",async()=>{
    const onBooked=vi.fn();render(<VirtualBooking current={current} onBooked={onBooked}/>);
    fireEvent.click(await screen.findByRole("button",{name:"11:00 AM"}));
    expect(action).toHaveBeenCalledTimes(1);
    expect(Object.fromEntries(action.mock.calls[0][0])).toEqual({action:"load",taskId:setterTaskId,token:setterClaimToken});
    fireEvent.change(screen.getByLabelText("Invite email"),{target:{value:"homeowner@example.com"}});
    fireEvent.change(screen.getByLabelText("Appointment notes"),{target:{value:"Alt phone 609-555-0199"}});
    expect(screen.getByRole("list",{name:"Before you book"})).toHaveTextContent("homeowner@example.com");
    action.mockResolvedValueOnce({ok:true,message:"Virtual inspection booked. Save the outcome to finish.",booking});
    fireEvent.click(screen.getByRole("button",{name:"Book Mon, Nov 2, 11:00 AM"}));
    expect(await screen.findByRole("status")).toHaveTextContent("Save the outcome to finish");
    expect(Object.fromEntries(action.mock.calls[1][0])).toEqual({action:"book",taskId:setterTaskId,token:setterClaimToken,startsAt:"2026-11-02T16:00:00.000Z",attendeeEmail:"homeowner@example.com",notes:"Alt phone 609-555-0199"});
    expect(onBooked).toHaveBeenCalledWith(booking);
  });
  test("the closing checklist names the address to verify",async()=>{
    render(<VirtualBooking current={current} onBooked={()=>{}}/>);
    expect(await screen.findByRole("list",{name:"Before you book"})).toHaveTextContent("Verify the address: 1 Test Lane");
  });
  test("rescheduling identifies the displayed appointment and observed revision",async()=>{
    action.mockResolvedValueOnce({ok:true,message:"Available",availability:availability(true)});
    render(<VirtualBooking current={current} onBooked={()=>{}}/>);
    expect(await screen.findByText("Monday, November 2 at 10:00 AM EST")).toBeInTheDocument();
    const moveButton=screen.getByRole("button",{name:"Move inspection"});
    await waitFor(()=>expect(moveButton).toBeEnabled());
    fireEvent.click(moveButton);
    fireEvent.click(await screen.findByRole("button",{name:"11:00 AM"}));
    action.mockResolvedValueOnce({ok:true,message:"Moved",booking});
    fireEvent.click(screen.getByRole("button",{name:"Move to Mon, Nov 2, 11:00 AM"}));
    await waitFor(()=>expect(action).toHaveBeenCalledTimes(2));
    expect(Object.fromEntries(action.mock.calls[1][0])).toEqual({action:"reschedule",taskId:setterTaskId,token:setterClaimToken,startsAt:"2026-11-02T16:00:00.000Z",appointmentId,revision:"3"});
  });
  test("slot contention clears the selection and offers refreshed real times",async()=>{
    render(<VirtualBooking current={current} onBooked={()=>{}}/>);
    fireEvent.click(await screen.findByRole("button",{name:"11:00 AM"}));
    const fresh=availability();fresh.model.days[0].slots.shift();
    action.mockResolvedValueOnce({ok:false,message:"That time was just taken",code:"slot_unavailable",availability:fresh});
    fireEvent.click(screen.getByRole("button",{name:"Book Mon, Nov 2, 11:00 AM"}));
    expect(await screen.findByRole("alert")).toHaveTextContent("just taken");
    expect(screen.queryByRole("button",{name:"11:00 AM"})).not.toBeInTheDocument();
    expect(screen.getByRole("button",{name:"Pick a time"})).toBeDisabled();
  });
  test("claim loss removes the picker and requires a queue refresh",async()=>{
    action.mockResolvedValueOnce({ok:false,message:"Claim expired or changed; reload the queue",code:"claim_changed"});
    render(<VirtualBooking current={current} onBooked={()=>{}}/>);
    expect(await screen.findByRole("alert")).toHaveTextContent("Claim expired");
    expect(screen.queryByRole("group",{name:"Inspection day"})).not.toBeInTheDocument();
    expect(screen.getByRole("button",{name:"Load available times"})).toBeDisabled();
  });
  test("no capacity cannot be mistaken for a bookable slot",async()=>{
    const empty=availability();empty.model.days=[];
    action.mockResolvedValueOnce({ok:true,message:"Available",availability:empty});
    render(<VirtualBooking current={current} onBooked={()=>{}}/>);
    expect(await screen.findByText(/No times are available/)).toBeInTheDocument();
    expect(screen.queryByRole("button",{name:/^Book /})).not.toBeInTheDocument();
  });
  test("an unavailable calendar gives a retry state without showing times",async()=>{
    action.mockResolvedValueOnce({ok:false,message:"Virtual booking is unavailable",code:"unavailable"});
    render(<VirtualBooking current={current} onBooked={()=>{}}/>);
    expect(await screen.findByRole("alert")).toHaveTextContent("unavailable");
    expect(screen.getByRole("button",{name:"Load available times"})).toBeEnabled();
    expect(screen.queryByRole("group",{name:"Inspection day"})).not.toBeInTheDocument();
  });
  test("saved confirmation preserves the company's booking timezone",async()=>{
    const central=availability();central.model.timezone="America/Chicago";
    action.mockResolvedValueOnce({ok:true,message:"Available",availability:central});
    render(<VirtualBooking current={current} onBooked={()=>{}}/>);
    expect(await screen.findByRole("group",{name:"Inspection time (America/Chicago)"})).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button",{name:"10:00 AM"}));
    action.mockResolvedValueOnce({ok:true,message:"Booked",booking:{...booking,startsAt:"2026-11-02T16:00:00.000Z",endsAt:"2026-11-02T16:30:00.000Z"}});
    fireEvent.click(screen.getByRole("button",{name:"Book Mon, Nov 2, 10:00 AM"}));
    expect(await screen.findByRole("status")).toHaveTextContent("Booked");
    expect(screen.getByText("Monday, November 2 at 10:00 AM CST")).toBeInTheDocument();
  });
  test("calendar failure preserves the existing inspection and is not reported as no capacity",async()=>{
    const failed={...availability(true),calendarAvailable:false};failed.model.days=[];
    action.mockResolvedValueOnce({ok:true,message:"Available",availability:failed});
    render(<VirtualBooking current={current} onBooked={()=>{}}/>);
    expect(await screen.findByText("Monday, November 2 at 10:00 AM EST")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("Calendar availability couldn't be checked");
    expect(screen.queryByText(/No times are available/)).not.toBeInTheDocument();
    expect(screen.getByRole("button",{name:"Move inspection"})).toBeDisabled();
  });
});
