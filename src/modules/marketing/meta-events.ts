import { createHash } from "node:crypto";

export type MetaEventName = "Lead" | "QualifiedLead" | "AssessmentCompleted";

export type MetaBrowserEventEnvelope = {
  name: MetaEventName;
  eventId: string;
  issuedAt: string;
};

export type MetaDeliverySource = {
  deliveryId: string;
  eventName: MetaEventName;
  eventId: string;
  eventTime: string;
  eventSourceUrl: string;
  email: string;
  phone: string;
  clientIpAddress: string | null;
  clientUserAgent: string | null;
  fbp: string | null;
  fbc: string | null;
};

export function normalizeMetaEmail(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
    throw new Error("Invalid Meta email");
  }
  return normalized;
}

export function normalizeMetaPhone(value: string, country: "US"): string {
  if (country !== "US") throw new Error("Unsupported Meta phone country");

  const trimmed = value.trim();
  if (!trimmed || /[^0-9+().\-\s]/.test(trimmed)) {
    throw new Error("Invalid US phone number");
  }
  if (trimmed.includes("+") && !/^\+1(?:[0-9().\-\s])+$/.test(trimmed)) {
    throw new Error("Invalid US phone number");
  }

  const digits = trimmed.replace(/\D/g, "");
  const national = digits.length === 11 && digits.startsWith("1")
    ? digits.slice(1)
    : digits.length === 10
      ? digits
      : null;
  if (!national || !/^[2-9]\d{2}[2-9]\d{6}$/.test(national)) {
    throw new Error("Invalid US phone number");
  }

  return `1${national}`;
}

export function hashMetaValue(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}
