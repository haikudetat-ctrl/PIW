// @vitest-environment node
import { expect, test, vi } from "vitest";

vi.mock("server-only", () => ({}));
const { SmsProviderError, TwilioMessagingClient, isValidTwilioSignature, twilioSignature } = await import("./twilio");

const PARAMS = { Body: "STOP", From: "+16095550101", MessageSid: `SM${"a".repeat(32)}`, To: "+16095550199" };
const URL = "https://app.rake.example/api/twilio/sms";

test("signs requests the way Twilio does", () => {
  // Reference value computed independently with Python's hmac module.
  expect(twilioSignature("test-auth-token", URL, PARAMS)).toBe("wASCyz9xiJPr4vQeCFkAPyu9nD0=");
  expect(isValidTwilioSignature("test-auth-token", ["https://other.example/x", URL], PARAMS, "wASCyz9xiJPr4vQeCFkAPyu9nD0=")).toBe(true);
  expect(isValidTwilioSignature("test-auth-token", [URL], { ...PARAMS, Body: "START" }, "wASCyz9xiJPr4vQeCFkAPyu9nD0=")).toBe(false);
  expect(isValidTwilioSignature("test-auth-token", [URL], PARAMS, null)).toBe(false);
});

const credentials = { accountSid: `AC${"1".repeat(32)}`, apiKeySid: `SK${"2".repeat(32)}`, apiKeySecret: "secret" };

test("sends through the Messaging Service with a status callback", async () => {
  const fetchImpl = vi.fn(async () => Response.json({ sid: `SM${"b".repeat(32)}`, status: "accepted" }, { status: 201 }));
  const client = new TwilioMessagingClient({ ...credentials, fetchImpl });
  const result = await client.send({
    messagingServiceSid: `MG${"3".repeat(32)}`,
    to: "+16095550101",
    body: "Hi Maria",
    statusCallback: "https://app.rake.example/api/twilio/sms/status",
  });
  expect(result).toEqual({ sid: `SM${"b".repeat(32)}`, status: "accepted" });
  const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
  expect(url).toBe(`https://api.twilio.com/2010-04-01/Accounts/AC${"1".repeat(32)}/Messages.json`);
  const form = new URLSearchParams(String(init.body));
  expect(Object.fromEntries(form)).toEqual({
    MessagingServiceSid: `MG${"3".repeat(32)}`,
    To: "+16095550101",
    Body: "Hi Maria",
    StatusCallback: "https://app.rake.example/api/twilio/sms/status",
  });
  expect((init.headers as Record<string, string>).authorization).toBe(
    `Basic ${Buffer.from(`SK${"2".repeat(32)}:secret`).toString("base64")}`,
  );
});

test("reports Twilio's error code when a send is rejected", async () => {
  const fetchImpl = vi.fn(async () => Response.json({ code: 21610, message: "Attempt to send to unsubscribed recipient" }, { status: 400 }));
  const client = new TwilioMessagingClient({ ...credentials, fetchImpl });
  const failure = client.send({ messagingServiceSid: `MG${"3".repeat(32)}`, to: "+16095550101", body: "Hi", statusCallback: null });
  await expect(failure).rejects.toBeInstanceOf(SmsProviderError);
  await expect(failure).rejects.toMatchObject({ code: "21610" });
});

test("refuses to start without real credentials", () => {
  expect(() => new TwilioMessagingClient({ ...credentials, accountSid: "" })).toThrow(SmsProviderError);
});

test.each([400,403,429])("HTTP %i is a definite rejection",async(status)=>{
 const client=new TwilioMessagingClient({...credentials,fetchImpl:async()=>Response.json({code:21610},{status})});
 await expect(client.send({messagingServiceSid:`MG${"3".repeat(32)}`,to:"+16095550101",body:"Hi",statusCallback:null})).rejects.toMatchObject({acceptance:"rejected"});
});
test.each([408,500,503])("HTTP %i may have accepted and is never blindly retried",async(status)=>{
 const fetchImpl=vi.fn(async()=>Response.json({code:20500},{status}));
 const client=new TwilioMessagingClient({...credentials,fetchImpl});
 await expect(client.send({messagingServiceSid:`MG${"3".repeat(32)}`,to:"+16095550101",body:"Hi",statusCallback:null})).rejects.toMatchObject({acceptance:"unknown"});
 expect(fetchImpl).toHaveBeenCalledTimes(1);
});
test("pins an approved send to the configured sender in its Messaging Service",async()=>{
 const fetchImpl=vi.fn(async()=>Response.json({sid:`SM${"b".repeat(32)}`,status:"queued"},{status:201}));
 await new TwilioMessagingClient({...credentials,fetchImpl}).send({messagingServiceSid:`MG${"3".repeat(32)}`,to:"+16095550101",from:"+16095550199",body:"Hi",statusCallback:null});
 const form=new URLSearchParams(String((fetchImpl.mock.calls[0] as unknown as [string,RequestInit])[1].body));
 expect(form.get("From")).toBe("+16095550199");
});
