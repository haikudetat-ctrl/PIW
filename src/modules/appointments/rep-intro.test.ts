import { describe, expect, test } from "vitest";
import {
  calculateRepIntroSendAt,
  composeRepIntroMessage,
  type RepIntroContext,
} from "./rep-intro";

const context: RepIntroContext = {
  appointmentId: "11111111-1111-4111-8111-111111111111",
  companyId: "22222222-2222-4222-8222-222222222222",
  repId: "33333333-3333-4333-8333-333333333333",
  scheduledAt: "2026-08-02T16:00:00.000Z",
  customerName: "Jordan Rivera",
  repName: "Alex Morgan",
  repBio: "Alex has helped New Jersey homeowners for 12 years.",
  repCredentials: "HAAG Certified",
  repCommunityConnection: "Coaches in the local youth soccer league",
};

describe("composeRepIntroMessage", () => {
  test("humanizes the assigned rep with every available profile detail", () => {
    const message = composeRepIntroMessage(context);

    expect(message.subject).toBe("Meet Alex Morgan, your All Season representative");
    expect(message.body).toContain("Hi Jordan,");
    expect(message.body).toContain(context.repBio);
    expect(message.body).toContain("Credentials: HAAG Certified");
    expect(message.body).toContain(
      "Community connection: Coaches in the local youth soccer league",
    );
  });

  test("omits empty optional details without leaving empty labels", () => {
    const message = composeRepIntroMessage({
      ...context,
      repBio: null,
      repCredentials: " ",
      repCommunityConnection: null,
    });

    expect(message.body).not.toContain("Credentials:");
    expect(message.body).not.toContain("Community connection:");
  });
});

describe("calculateRepIntroSendAt", () => {
  test("schedules the intro 24 hours before the appointment", () => {
    expect(
      calculateRepIntroSendAt(context.scheduledAt, new Date("2026-07-30T12:00:00.000Z")),
    ).toEqual(new Date("2026-08-01T16:00:00.000Z"));
  });

  test("uses now when the appointment is already inside the lead-time window", () => {
    const now = new Date("2026-08-02T12:00:00.000Z");
    expect(calculateRepIntroSendAt(context.scheduledAt, now)).toEqual(now);
  });
});
