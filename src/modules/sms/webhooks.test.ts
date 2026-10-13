import { beforeEach, expect, test, vi } from "vitest";
import { handleInboundSms, handleStatusCallback, type InboundDeps, type StatusDeps } from "./webhooks";

const SID = `SM${"a".repeat(32)}`;
let inbound: { [K in keyof InboundDeps]: ReturnType<typeof vi.fn> };

beforeEach(() => {
  inbound = {
    findCompanyByNumber: vi.fn(async () => "company-1"),
    findLeadByPhone: vi.fn(async () => "lead-1"),
    insertInbound: vi.fn(async () => undefined),
    suppress: vi.fn(async () => undefined),
    unsuppress: vi.fn(async () => undefined),
  };
});

const params = (body: string) => ({ From: "+16095550101", To: "+16095550199", Body: body, MessageSid: SID });

test("records a reply against the lead with that number", async () => {
  await expect(handleInboundSms(params("Tuesday after 4 works"), inbound as unknown as InboundDeps)).resolves.toBe("recorded");
  expect(inbound.findCompanyByNumber).toHaveBeenCalledWith("+16095550199");
  expect(inbound.findLeadByPhone).toHaveBeenCalledWith("company-1", "+16095550101");
  expect(inbound.insertInbound).toHaveBeenCalledWith({
    company_id: "company-1",
    lead_id: "lead-1",
    direction: "inbound",
    body: "Tuesday after 4 works",
    from_e164: "+16095550101",
    to_e164: "+16095550199",
    status: "received",
    provider_sid: SID,
  });
  expect(inbound.suppress).not.toHaveBeenCalled();
});

test("STOP suppresses the number and START lifts it", async () => {
  await handleInboundSms(params("Stop"), inbound as unknown as InboundDeps);
  expect(inbound.suppress).toHaveBeenCalledWith("company-1", "+16095550101");
  await handleInboundSms(params("START"), inbound as unknown as InboundDeps);
  expect(inbound.unsuppress).toHaveBeenCalledWith("company-1", "+16095550101");
});

test("ignores texts to numbers Rake doesn't own and malformed requests", async () => {
  inbound.findCompanyByNumber.mockResolvedValue(null);
  await expect(handleInboundSms(params("hi"), inbound as unknown as InboundDeps)).resolves.toBe("ignored");
  await expect(handleInboundSms({ ...params("hi"), MessageSid: "nope" }, inbound as unknown as InboundDeps)).resolves.toBe("ignored");
  expect(inbound.insertInbound).not.toHaveBeenCalled();
});

test("delivery updates only move a text forward", async () => {
  const status = {
    findBySid: vi.fn(async () => ({ id: "message-1", status: "sent" as const })),
    updateStatus: vi.fn(async () => undefined),
  };
  const deps = status as unknown as StatusDeps;
  await expect(handleStatusCallback({ MessageSid: SID, MessageStatus: "delivered" }, deps)).resolves.toBe("updated");
  expect(status.updateStatus).toHaveBeenCalledWith("message-1", "delivered", null);
  await expect(handleStatusCallback({ MessageSid: SID, MessageStatus: "queued" }, deps)).resolves.toBe("ignored");
  await expect(
    handleStatusCallback({ MessageSid: SID, MessageStatus: "undelivered", ErrorCode: "30007" }, deps),
  ).resolves.toBe("updated");
  expect(status.updateStatus).toHaveBeenLastCalledWith("message-1", "undelivered", "30007");
});
