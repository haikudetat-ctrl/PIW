const calendarIdShape = /^[^\s@/?#:]+@[^\s@/?#:]+\.[^\s@/?#:]+$/;

/**
 * Google calendar IDs look like email addresses, and copying one often brings
 * extra text along: a `mailto:` link when a phone treats it as an address, the
 * calendar's public or embed URL, or stray spaces. Keep only the ID, or return
 * null when what was pasted is not one.
 */
export function normalizeCalendarId(input: string): string | null {
  let value = input.trim();
  if (/^https?:\/\//i.test(value)) {
    try {
      value = new URL(value).searchParams.get("src") ?? "";
    } catch {
      return null;
    }
  }
  value = value.replace(/^mailto:/i, "").replace(/%40/gi, "@").trim();
  return calendarIdShape.test(value) ? value : null;
}
