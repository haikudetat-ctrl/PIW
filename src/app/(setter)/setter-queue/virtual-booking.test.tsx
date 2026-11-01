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
  test("loads times only for the current claim then books with the confirmed email",async()=>{
    const onSaved=vi.fn();render(<VirtualBooking current={current} onSaved={onSaved}/>);
    fireEvent.click(screen.getByRole("button",{name:"Load available times"}));
    await screen.findByLabelText("Inspection time (America/New_York)");
    expect(Object.fromEntries(action.mock.calls[0][0])).toEqual({action:"load",taskId:setterTaskId,token:setterClaimToken});
    fireEvent.change(screen.getByLabelText("Inspection time (America/New_York)"),{target:{value:"2026-11-02T16:00:00.000Z"}});
    fireEvent.change(screen.getByLabelText("Invite email"),{target:{value:"homeowner@example.com"}});
    fireEvent.change(screen.getByLabelText("Appointment notes"),{target:{value:"Porch leak"}});
    action.mockResolvedValueOnce({ok:true,message:"Virtual inspection booked. Record the call outcome below.",booking});
    fireEvent.click(screen.getByRole("button",{name:"Confirm virtual booking"}));
    expect(await screen.findByRole("status")).toHaveTextContent("Record the call outcome");
    expect(Object.fromEntries(action.mock.calls[1][0])).toEqual({action:"book",taskId:setterTaskId,token:setterClaimToken,startsAt:"2026-11-02T16:00:00.000Z",attendeeEmail:"homeowner@example.com",notes:"Porch leak"});
    expect(onSaved).toHaveBeenCalledTimes(1);
  });
  test("rescheduling identifies the displayed appointment and observed revision",async()=>{
    action.mockResolvedValueOnce({ok:true,message:"Available",availability:availability(true)});
    render(<VirtualBooking current={current} onSaved={()=>{}}/>);
    fireEvent.click(screen.getByRole("button",{name:"Load available times"}));
    expect(await screen.findByText("Monday, November 2 at 10:00 AM EST")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button",{name:"Move inspection"}));
    fireEvent.change(screen.getByLabelText("Inspection time (America/New_York)"),{target:{value:"2026-11-02T16:00:00.000Z"}});
    action.mockResolvedValueOnce({ok:true,message:"Moved",booking});
    fireEvent.click(screen.getByRole("button",{name:"Confirm new time"}));
    await waitFor(()=>expect(action).toHaveBeenCalledTimes(2));
    expect(Object.fromEntries(action.mock.calls[1][0])).toEqual({action:"reschedule",taskId:setterTaskId,token:setterClaimToken,startsAt:"2026-11-02T16:00:00.000Z",appointmentId,revision:"3"});
  });
  test("slot contention clears the selection and offers refreshed real times",async()=>{
    render(<VirtualBooking current={current} onSaved={()=>{}}/>);
    fireEvent.click(screen.getByRole("button",{name:"Load available times"}));
    fireEvent.change(await screen.findByLabelText("Inspection time (America/New_York)"),{target:{value:"2026-11-02T16:00:00.000Z"}});
    const fresh=availability();fresh.model.days[0].slots.shift();
    action.mockResolvedValueOnce({ok:false,message:"That time was just taken",code:"slot_unavailable",availability:fresh});
    fireEvent.click(screen.getByRole("button",{name:"Confirm virtual booking"}));
    expect(await screen.findByRole("alert")).toHaveTextContent("just taken");
    expect(screen.queryByRole("option",{name:"11:00 AM EST"})).not.toBeInTheDocument();
    expect(screen.getByRole("button",{name:"Confirm virtual booking"})).toBeDisabled();
  });
  test("claim loss removes the picker and requires a queue refresh",async()=>{
    action.mockResolvedValueOnce({ok:false,message:"Claim expired or changed; reload the queue",code:"claim_changed"});
    render(<VirtualBooking current={current} onSaved={()=>{}}/>);
    fireEvent.click(screen.getByRole("button",{name:"Load available times"}));
    expect(await screen.findByRole("alert")).toHaveTextContent("Claim expired");
    expect(screen.queryByLabelText("Inspection date")).not.toBeInTheDocument();
    expect(screen.getByRole("button",{name:"Load available times"})).toBeDisabled();
  });
  test("no capacity cannot be mistaken for a bookable slot",async()=>{
    const empty=availability();empty.model.days=[];
    action.mockResolvedValueOnce({ok:true,message:"Available",availability:empty});
    render(<VirtualBooking current={current} onSaved={()=>{}}/>);
    fireEvent.click(screen.getByRole("button",{name:"Load available times"}));
    expect(await screen.findByText(/No times are available/)).toBeInTheDocument();
    expect(screen.queryByRole("button",{name:"Confirm virtual booking"})).not.toBeInTheDocument();
  });
  test("an unavailable calendar gives a retry state without showing times",async()=>{
    action.mockResolvedValueOnce({ok:false,message:"Virtual booking is unavailable",code:"unavailable"});
    render(<VirtualBooking current={current} onSaved={()=>{}}/>);
    fireEvent.click(screen.getByRole("button",{name:"Load available times"}));
    expect(await screen.findByRole("alert")).toHaveTextContent("unavailable");
    expect(screen.getByRole("button",{name:"Load available times"})).toBeEnabled();
    expect(screen.queryByLabelText("Inspection date")).not.toBeInTheDocument();
  });
  test("saved confirmation preserves the company's booking timezone",async()=>{
    const central=availability();central.model.timezone="America/Chicago";
    action.mockResolvedValueOnce({ok:true,message:"Available",availability:central});
    render(<VirtualBooking current={current} onSaved={()=>{}}/>);
    fireEvent.click(screen.getByRole("button",{name:"Load available times"}));
    fireEvent.change(await screen.findByLabelText("Inspection time (America/Chicago)"),{target:{value:"2026-11-02T16:00:00.000Z"}});
    action.mockResolvedValueOnce({ok:true,message:"Booked",booking:{...booking,startsAt:"2026-11-02T16:00:00.000Z",endsAt:"2026-11-02T16:30:00.000Z"}});
    fireEvent.click(screen.getByRole("button",{name:"Confirm virtual booking"}));
    expect(await screen.findByRole("status")).toHaveTextContent("Booked");
    expect(screen.getByText("Monday, November 2 at 10:00 AM CST")).toBeInTheDocument();
  });
  test("calendar failure preserves the existing inspection and is not reported as no capacity",async()=>{
    const failed={...availability(true),calendarAvailable:false};failed.model.days=[];
    action.mockResolvedValueOnce({ok:true,message:"Available",availability:failed});
    render(<VirtualBooking current={current} onSaved={()=>{}}/>);
    fireEvent.click(screen.getByRole("button",{name:"Load available times"}));
    expect(await screen.findByText("Monday, November 2 at 10:00 AM EST")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("Calendar availability couldn't be checked");
    expect(screen.queryByText(/No times are available/)).not.toBeInTheDocument();
    expect(screen.getByRole("button",{name:"Move inspection"})).toBeDisabled();
  });
});
