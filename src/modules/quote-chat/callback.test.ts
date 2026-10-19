import {describe, expect, test, vi} from "vitest";
import {callbackDueAt, handleCallbackRequest} from "./callback";

const token = "11111111-1111-4111-8111-111111111111";
// 10:30 Eastern on a Monday in October (EDT, UTC-4).
const midMorning = new Date("2026-10-19T14:30:00.000Z");

describe("callbackDueAt", () => {
  test("as soon as possible is due now", () => {
    expect(callbackDueAt("asap", midMorning)).toEqual(midMorning);
  });

  test("an open window is due now, a later one today at its start", () => {
    expect(callbackDueAt("morning", midMorning)).toEqual(midMorning);
    expect(callbackDueAt("afternoon", midMorning).toISOString()).toBe("2026-10-19T16:00:00.000Z");
    expect(callbackDueAt("evening", midMorning).toISOString()).toBe("2026-10-19T21:00:00.000Z");
  });

  test("a window that has passed is due tomorrow", () => {
    expect(callbackDueAt("morning", new Date("2026-10-19T20:00:00.000Z")).toISOString()).toBe("2026-10-20T13:00:00.000Z");
  });

  test("follows the clock change", () => {
    // Saturday Oct 31 evening, the morning window on Sunday Nov 1 is after the switch to EST.
    expect(callbackDueAt("morning", new Date("2026-11-01T01:00:00.000Z")).toISOString()).toBe("2026-11-01T14:00:00.000Z");
  });
});

describe("handleCallbackRequest", () => {
  test("records the request with its due time", async () => {
    const requestCallback = vi.fn(async () => ({created: true}));
    const response = await handleCallbackRequest({
      token,
      body: {callWindow: "afternoon"},
      repository: {requestCallback},
      now: () => midMorning,
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({callWindow: "afternoon", created: true});
    expect(requestCallback).toHaveBeenCalledWith({
      estimateToken: token,
      callWindow: "afternoon",
      dueAt: new Date("2026-10-19T16:00:00.000Z"),
    });
  });

  test.each([
    ["a malformed token", "nope", {callWindow: "asap"}, 404],
    ["an unknown window", token, {callWindow: "midnight"}, 400],
    ["extra fields", token, {callWindow: "asap", phone: "555"}, 400],
  ])("refuses %s", async (_label, value, body, status) => {
    const requestCallback = vi.fn();
    const response = await handleCallbackRequest({token: value, body, repository: {requestCallback}});
    expect(response.status).toBe(status);
    expect(requestCallback).not.toHaveBeenCalled();
  });

  test("answers 404 for an unknown estimate and 503 when the database fails", async () => {
    expect((await handleCallbackRequest({token, body: {callWindow: "asap"}, repository: {requestCallback: async () => null}})).status).toBe(404);
    expect((await handleCallbackRequest({
      token,
      body: {callWindow: "asap"},
      repository: {requestCallback: async () => { throw new Error("down"); }},
    })).status).toBe(503);
  });
});
