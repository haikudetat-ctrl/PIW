import type { RoofComplexity } from "@/domain/roof-complexity";
import { composePreviewReportEmail, type PreviewReportKind } from "./preview-report-email";

// Decides whether a saved-report email may go out and sends it. The report
// itself is what the homeowner just asked for; reminders only go to an
// active, unconverted, subscribed preview, in order, at most two.

export type SendPreviewReportDependencies = {
  loadPreview(scope: {companyId: string; previewId: string}): Promise<{
    status: string;
    expiresAt: string;
    savedEmail: string | null;
    savedEmailNormalized: string | null;
    unsubscribedAt: string | null;
    remindersSent: number;
    address: string;
  } | null>;
  loadRoof(scope: {companyId: string; previewId: string}): Promise<{squares: number; complexity: RoofComplexity} | null>;
  isSuppressed(input: {companyId: string; emailNormalized: string}): Promise<boolean>;
  resolveHost(companyId: string): Promise<string | null>;
  brandName: string;
  signLink(purpose: "resume" | "unsubscribe", previewId: string): string;
  // unsubscribeUrl opens a confirmation page (safe from link scanners);
  // oneClickUnsubscribeUrl is the RFC 8058 POST target for mail clients.
  sendEmail(input: {to: string; subject: string; text: string; unsubscribeUrl: string; oneClickUnsubscribeUrl: string; idempotencyKey: string}): Promise<void>;
  markReminderSent(input: {companyId: string; previewId: string; remindersSent: number}): Promise<void>;
  now?: () => Date;
};

const REMINDER_NUMBER = {reminder_1: 1, reminder_2: 2} as const;

export async function sendPreviewReport(
  input: {companyId: string; previewId: string; kind: PreviewReportKind},
  dependencies: SendPreviewReportDependencies,
): Promise<{outcome: "sent" | "skipped"}> {
  const scope = {companyId: input.companyId, previewId: input.previewId};
  const now = (dependencies.now ?? (() => new Date()))();
  const preview = await dependencies.loadPreview(scope);
  if (!preview?.savedEmail || !preview.savedEmailNormalized) return {outcome: "skipped"};

  const host = await dependencies.resolveHost(input.companyId);
  if (!host) return {outcome: "skipped"};

  if (input.kind !== "report") {
    const number = REMINDER_NUMBER[input.kind];
    const eligible = preview.status === "active"
      && new Date(preview.expiresAt) > now
      && preview.unsubscribedAt === null
      && preview.remindersSent === number - 1
      && !(await dependencies.isSuppressed({companyId: input.companyId, emailNormalized: preview.savedEmailNormalized}));
    if (!eligible) return {outcome: "skipped"};
  } else if (preview.status !== "active" || new Date(preview.expiresAt) <= now) {
    return {outcome: "skipped"};
  }

  const base = `https://${host}/roof-estimate/p`;
  const unsubscribeLink = dependencies.signLink("unsubscribe", input.previewId);
  const unsubscribeUrl = `${base}/unsubscribe/${unsubscribeLink}`;
  const email = composePreviewReportEmail({
    kind: input.kind,
    brandName: dependencies.brandName,
    address: preview.address,
    roof: await dependencies.loadRoof(scope),
    resumeUrl: `${base}/resume/${dependencies.signLink("resume", input.previewId)}`,
    unsubscribeUrl,
  });

  await dependencies.sendEmail({
    to: preview.savedEmail,
    subject: email.subject,
    text: email.text,
    unsubscribeUrl,
    oneClickUnsubscribeUrl: `https://${host}/api/property-preview/unsubscribe/${unsubscribeLink}`,
    idempotencyKey: `preview-report/${input.previewId}/${input.kind}/${now.toISOString().slice(0, 10)}`,
  });
  if (input.kind !== "report") {
    await dependencies.markReminderSent({...scope, remindersSent: REMINDER_NUMBER[input.kind]});
  }
  return {outcome: "sent"};
}
