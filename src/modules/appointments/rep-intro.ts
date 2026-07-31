export const REP_INTRO_LEAD_TIME_HOURS = 24;

export type RepIntroContext = {
  appointmentId: string;
  companyId: string;
  repId: string;
  scheduledAt: string;
  customerName: string;
  repName: string;
  repBio: string | null;
  repCredentials: string | null;
  repCommunityConnection: string | null;
};

export type ComposedRepIntro = {
  subject: string;
  body: string;
};

function present(value: string | null): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

export function composeRepIntroMessage(context: RepIntroContext): ComposedRepIntro {
  const customerFirstName = context.customerName.trim().split(/\s+/)[0] || "there";
  const repName = context.repName.trim();
  const details = [
    present(context.repBio),
    present(context.repCredentials)
      ? `Credentials: ${present(context.repCredentials)}`
      : null,
    present(context.repCommunityConnection)
      ? `Community connection: ${present(context.repCommunityConnection)}`
      : null,
  ].filter((detail): detail is string => detail !== null);

  const paragraphs = [
    `Hi ${customerFirstName},`,
    `Ahead of your scheduled visit, we'd like to introduce ${repName}, the representative who will be meeting with you.`,
    ...details,
    `${repName} will arrive ready to learn about your roofing needs and answer your questions.`,
  ];

  return {
    subject: `Meet ${repName}, your All Season representative`,
    body: paragraphs.join("\n\n"),
  };
}

export function calculateRepIntroSendAt(
  scheduledAt: string,
  now: Date,
  leadTimeHours = REP_INTRO_LEAD_TIME_HOURS,
): Date {
  const scheduledTime = new Date(scheduledAt).getTime();
  if (!Number.isFinite(scheduledTime)) {
    throw new Error("Appointment has an invalid scheduled time");
  }

  const desiredTime = scheduledTime - leadTimeHours * 60 * 60 * 1000;
  return new Date(Math.max(now.getTime(), desiredTime));
}
