// A single-event iCalendar file so homeowners on any calendar app can add the
// consultation, independent of the Google invite.

function escapeText(value: string) {
  return value.replaceAll("\\", "\\\\").replaceAll(";", "\\;").replaceAll(",", "\\,").replace(/\r?\n/g, "\\n");
}

function utcStamp(instant: Date) {
  return instant.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

/** Folds lines longer than 75 octets as RFC 5545 requires. */
function fold(line: string) {
  const chunks: string[] = [];
  let rest = line;
  while (Buffer.byteLength(rest, "utf8") > 75) {
    let cut = 75;
    while (Buffer.byteLength(rest.slice(0, cut), "utf8") > 75) cut -= 1;
    chunks.push(rest.slice(0, cut));
    rest = ` ${rest.slice(cut)}`;
  }
  chunks.push(rest);
  return chunks.join("\r\n");
}

export function buildCalendarFile(input: {
  appointmentId: string;
  title: string;
  startsAt: string;
  endsAt: string;
  meetingUrl: string | null;
  organizerName: string;
  now: Date;
}) {
  const description = input.meetingUrl
    ? `Join on Google Meet: ${input.meetingUrl}`
    : "Your Google Meet link is in the calendar invite we emailed you.";
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Rake//Virtual consultations//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${input.appointmentId}@rake-booking`,
    `DTSTAMP:${utcStamp(input.now)}`,
    `DTSTART:${utcStamp(new Date(input.startsAt))}`,
    `DTEND:${utcStamp(new Date(input.endsAt))}`,
    `SUMMARY:${escapeText(`${input.title} with ${input.organizerName}`)}`,
    `DESCRIPTION:${escapeText(description)}`,
    ...(input.meetingUrl ? [`URL:${input.meetingUrl}`, `LOCATION:${escapeText(input.meetingUrl)}`] : []),
    "STATUS:CONFIRMED",
    "BEGIN:VALARM",
    "ACTION:DISPLAY",
    "DESCRIPTION:Video consultation in 15 minutes",
    "TRIGGER:-PT15M",
    "END:VALARM",
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  return `${lines.map(fold).join("\r\n")}\r\n`;
}
