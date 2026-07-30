import { expect, test } from "vitest";
import {
  buildRepIntroPlan,
  queueRepIntroPlan,
  type RepIntroSenderRepository,
} from "./rep-intro-sender";
import type { RepIntroContext } from "@/modules/appointments/rep-intro";

class FakeRepIntroRepository implements RepIntroSenderRepository {
  queuedByAppointment = new Map<
    string,
    { repId: string; subject: string; body: string; scheduledFor: string }
  >();
  audits: Array<{ appointmentId: string; correlationId: string }> = [];

  async loadContext(appointmentId: string, repId: string): Promise<RepIntroContext> {
    return {
      appointmentId,
      companyId: "11111111-1111-4111-8111-111111111111",
      repId,
      scheduledAt: "2026-08-02T16:00:00.000Z",
      customerName: "Jordan Rivera",
      repName: "Alex Morgan",
      repBio: "Alex has helped New Jersey homeowners for 12 years.",
      repCredentials: "HAAG Certified",
      repCommunityConnection: "Lives and volunteers in Mercer County",
    };
  }

  async queueIntro(input: {
    context: RepIntroContext;
    subject: string;
    body: string;
    scheduledFor: string;
  }) {
    this.queuedByAppointment.set(input.context.appointmentId, {
      repId: input.context.repId,
      subject: input.subject,
      body: input.body,
      scheduledFor: input.scheduledFor,
    });
  }

  async writeAudit(input: {
    context: RepIntroContext;
    correlationId: string;
  }) {
    this.audits.push({
      appointmentId: input.context.appointmentId,
      correlationId: input.correlationId,
    });
  }
}

test("builds and idempotently queues a humanizing rep intro", async () => {
  const repository = new FakeRepIntroRepository();
  const appointmentId = "22222222-2222-4222-8222-222222222222";
  const repId = "33333333-3333-4333-8333-333333333333";
  const event = {
    id: "44444444-4444-4444-8444-444444444444",
    correlationId: "55555555-5555-4555-8555-555555555555",
  };
  const plan = await buildRepIntroPlan(
    { appointmentId, repId },
    repository,
    new Date("2026-07-30T12:00:00.000Z"),
  );

  await queueRepIntroPlan(plan, event, repository);
  await queueRepIntroPlan(plan, event, repository);

  expect(repository.queuedByAppointment).toHaveLength(1);
  expect(repository.queuedByAppointment.get(appointmentId)).toMatchObject({
    repId,
    subject: "Meet Alex Morgan, your All Season representative",
    scheduledFor: "2026-08-01T16:00:00.000Z",
  });
  expect(repository.queuedByAppointment.get(appointmentId)?.body).toContain(
    "Lives and volunteers in Mercer County",
  );
});
