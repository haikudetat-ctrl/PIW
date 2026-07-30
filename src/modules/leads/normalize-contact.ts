// PIW is NJ-only (see architecture design §1), so a US-centric E.164
// normalizer is sufficient — this is not a general phone-parsing library.
export function normalizePhoneToE164(phone: string): string | null {
  const digits = phone.replace(/\D/g, "");
  const tenDigit = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;

  if (tenDigit.length !== 10) return null;

  return `+1${tenDigit}`;
}

export function normalizeEmailForMatching(email: string): string {
  return email.trim().toLowerCase();
}
