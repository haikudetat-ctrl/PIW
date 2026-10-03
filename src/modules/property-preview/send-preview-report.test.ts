import { describe, expect, test, vi } from "vitest";
import { sendPreviewReport, type SendPreviewReportDependencies } from "./send-preview-report";

const scope = {companyId: "11111111-1111-4111-8111-111111111111", previewId: "22222222-2222-4222-8222-222222222222"};
const preview = {
  status: "active",
  expiresAt: "2099-01-01T00:00:00.000Z",
  savedEmail: "Alex@Example.com",
  savedEmailNormalized: "alex@example.com",
  unsubscribedAt: null,
  remindersSent: 0,
  address: "1 Main St, Newark, NJ 07102, USA",
};

function deps(overrides: Partial<SendPreviewReportDependencies> = {}) {
  return {
    loadPreview: vi.fn(async () => preview),
    loadRoof: vi.fn(async () => ({squares: 24, complexity: "moderate" as const})),
    isSuppressed: vi.fn(async () => false),
    resolveHost: vi.fn(async () => "estimate.allseasonroofingquote.com"),
    brandName: "All Season Solar",
    signLink: vi.fn((purpose: string, id: string) => `${id}.${purpose}-sig`),
    sendEmail: vi.fn(async () => undefined),
    markReminderSent: vi.fn(async () => undefined),
    now: () => new Date("2026-10-04T12:00:00.000Z"),
    ...overrides,
  } satisfies SendPreviewReportDependencies;
}

describe("sendPreviewReport", () => {
  test("sends the requested report with signed resume and unsubscribe links", async () => {
    const d = deps();
    await expect(sendPreviewReport({...scope, kind: "report"}, d)).resolves.toEqual({outcome: "sent"});
    expect(d.sendEmail).toHaveBeenCalledWith(expect.objectContaining({
      to: "Alex@Example.com",
      unsubscribeUrl: `https://estimate.allseasonroofingquote.com/roof-estimate/p/unsubscribe/${scope.previewId}.unsubscribe-sig`,
      oneClickUnsubscribeUrl: `https://estimate.allseasonroofingquote.com/api/property-preview/unsubscribe/${scope.previewId}.unsubscribe-sig`,
      idempotencyKey: `preview-report/${scope.previewId}/report/2026-10-04`,
    }));
    const {text} = vi.mocked(d.sendEmail).mock.calls[0][0];
    expect(text).toContain(`https://estimate.allseasonroofingquote.com/roof-estimate/p/resume/${scope.previewId}.resume-sig`);
    expect(d.markReminderSent).not.toHaveBeenCalled();
  });

  test("still sends an explicitly requested report to a suppressed address", async () => {
    const d = deps({isSuppressed: vi.fn(async () => true)});
    await expect(sendPreviewReport({...scope, kind: "report"}, d)).resolves.toEqual({outcome: "sent"});
  });

  test("sends reminders in order and records them", async () => {
    const d = deps();
    await expect(sendPreviewReport({...scope, kind: "reminder_1"}, d)).resolves.toEqual({outcome: "sent"});
    expect(d.markReminderSent).toHaveBeenCalledWith({...scope, remindersSent: 1});

    const second = deps({loadPreview: vi.fn(async () => ({...preview, remindersSent: 1}))});
    await expect(sendPreviewReport({...scope, kind: "reminder_2"}, second)).resolves.toEqual({outcome: "sent"});
    expect(second.markReminderSent).toHaveBeenCalledWith({...scope, remindersSent: 2});
  });

  test.each([
    ["converted", {status: "converted"}],
    ["expired", {expiresAt: "2026-10-01T00:00:00.000Z"}],
    ["unsubscribed", {unsubscribedAt: "2026-10-03T00:00:00.000Z"}],
    ["out of order", {remindersSent: 1}],
  ])("skips a reminder when the preview is %s", async (_label, overrides) => {
    const d = deps({loadPreview: vi.fn(async () => ({...preview, ...overrides}))});
    await expect(sendPreviewReport({...scope, kind: "reminder_1"}, d)).resolves.toEqual({outcome: "skipped"});
    expect(d.sendEmail).not.toHaveBeenCalled();
  });

  test("skips reminders to a suppressed address", async () => {
    const d = deps({isSuppressed: vi.fn(async () => true)});
    await expect(sendPreviewReport({...scope, kind: "reminder_1"}, d)).resolves.toEqual({outcome: "skipped"});
    expect(d.sendEmail).not.toHaveBeenCalled();
  });

  test("skips when there is no saved email or no verified host", async () => {
    expect(await sendPreviewReport({...scope, kind: "report"}, deps({loadPreview: vi.fn(async () => ({...preview, savedEmail: null, savedEmailNormalized: null}))})))
      .toEqual({outcome: "skipped"});
    expect(await sendPreviewReport({...scope, kind: "report"}, deps({resolveHost: vi.fn(async () => null)})))
      .toEqual({outcome: "skipped"});
  });
});
