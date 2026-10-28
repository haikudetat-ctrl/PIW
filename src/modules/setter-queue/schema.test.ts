import {describe,expect,test} from "vitest";
import {callbackLocalToIso,parseQueueCommand,queueActionError} from "./schema";
const taskId="b5000000-0000-4000-8000-000000000001";
const token="b5000000-0000-4000-8000-000000000002";

describe("callback scheduling",()=>{
  test("converts the company's wall clock, independently of server timezone",()=>{
    expect(callbackLocalToIso("2026-10-28T09:15","America/New_York")).toBe("2026-10-28T13:15:00.000Z");
    expect(callbackLocalToIso("2026-12-02T09:15","America/Los_Angeles")).toBe("2026-12-02T17:15:00.000Z");
  });
  test.each(["2026-03-08T02:30","2026-11-01T01:30","2026-02-30T10:00","tomorrow","2026-10-28T25:00"])("rejects nonexistent, ambiguous or invalid wall time: %s",value=>{
    expect(()=>callbackLocalToIso(value,"America/New_York")).toThrow();
  });
  test("callback outcome requires a time and preserves its exact instant",()=>{
    expect(parseQueueCommand({action:"outcome",taskId,token,outcome:"callback_scheduled",callbackLocal:"2026-10-28T09:15",notes:"After school drop-off"},"America/New_York"))
      .toEqual({action:"outcome",taskId,token,outcome:"callback_scheduled",callbackAt:"2026-10-28T13:15:00.000Z",appointmentId:null,notes:"After school drop-off"});
    expect(()=>parseQueueCommand({action:"outcome",taskId,token,outcome:"callback_scheduled"},"America/New_York")).toThrow();
  });
});

describe("queue command validation",()=>{
  test("disqualified and handoff require a useful reason",()=>{
    for(const outcome of ["disqualified","handoff"]) {
      expect(()=>parseQueueCommand({action:"outcome",taskId,token,outcome,notes:" "},"America/New_York")).toThrow("A reason is required");
    }
  });
  test("booked outcome requires an appointment",()=>{
    expect(()=>parseQueueCommand({action:"outcome",taskId,token,outcome:"booked_virtual"},"America/New_York")).toThrow();
  });
  test("cannot supply tenant identity or choose an unsupported command",()=>{
    expect(()=>parseQueueCommand({action:"claim",companyId:taskId},"America/New_York")).toThrow();
    expect(()=>parseQueueCommand({action:"send_sms"},"America/New_York")).toThrow();
  });
  test("maps known contention errors without exposing infrastructure errors",()=>{
    expect(queueActionError({code:"40001",message:"Claim expired or changed; reload the queue"})).toMatch(/Claim expired/);
    expect(queueActionError({message:"postgres://secret@example.com private data"})).toBe("Couldn't update the queue. Reload and try again.");
  });
});
