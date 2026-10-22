import type {MetaBrowserEventEnvelope} from "@/modules/marketing/meta-events";
import type {BookingPageModel, BookingSummary} from "@/modules/booking/booking-service";
import type {PreviewView} from "@/modules/property-preview/preview-read-model";
import type {CallWindow, ChatEstimateSummary} from "@/modules/quote-chat/types";

export type PreviewQuestionKey = "reason" | "roofAge" | "timeline";

export type ConvertResult =
  | {kind: "accepted"; continuationPath: string; metaEvent: MetaBrowserEventEnvelope | null}
  | {kind: "invalid"}
  | {kind: "expired"}
  | {kind: "failed"};

export type ContinueResult =
  | {kind: "estimate"; estimateToken: string}
  | {kind: "elsewhere"}
  | {kind: "failed"};

export type BookResult =
  | {kind: "booked"; booking: BookingSummary}
  | {kind: "taken"}
  | {kind: "already_booked"}
  | {kind: "failed"; message: string | null};

/**
 * Every call the quote chat makes. All of them are PIW's existing public
 * endpoints on the estimate host, scoped by the capability token the chat holds
 * at that point: the preview token, then the estimate token, then the booking link.
 */
export type ChatApi = {
  loadPreview(token: string): Promise<PreviewView | null>;
  answer(token: string, key: PreviewQuestionKey, value: string): void;
  beacon(token: string, step: "revealed" | "contact_viewed"): void;
  convert(token: string, contact: {submission_id: string; name: string; email: string; phone: string}): Promise<ConvertResult>;
  continueToEstimate(continuationPath: string): Promise<ContinueResult>;
  loadEstimate(estimateToken: string): Promise<ChatEstimateSummary | null>;
  bookingLink(estimateToken: string): Promise<string | null>;
  bookingOverview(bookingToken: string): Promise<BookingPageModel | null>;
  book(bookingToken: string, input: {startsAt: string; attendeeEmail?: string}): Promise<BookResult>;
  requestCallback(estimateToken: string, callWindow: CallWindow): Promise<boolean>;
};

const json = {"content-type": "application/json"};

async function readJson<T>(response: Response | null): Promise<T | null> {
  if (!response?.ok) return null;
  return await response.json().catch(() => null) as T | null;
}

const enc = encodeURIComponent;

export const browserChatApi: ChatApi = {
  async loadPreview(token) {
    return readJson<PreviewView>(await fetch(`/api/property-preview/${enc(token)}`, {cache: "no-store"}).catch(() => null));
  },
  answer(token, key, value) {
    void fetch(`/api/property-preview/${enc(token)}/answers`, {
      method: "POST",
      headers: json,
      body: JSON.stringify({[key]: value}),
      keepalive: true,
    }).catch(() => undefined);
  },
  beacon(token, step) {
    void fetch(`/api/property-preview/${enc(token)}/progress`, {
      method: "POST",
      headers: json,
      body: JSON.stringify({step}),
      keepalive: true,
    }).catch(() => undefined);
  },
  async convert(token, contact) {
    const response = await fetch(`/api/property-preview/${enc(token)}/convert`, {
      method: "POST",
      headers: json,
      body: JSON.stringify(contact),
    }).catch(() => null);
    if (response?.status === 400) return {kind: "invalid"};
    if (response?.status === 404) return {kind: "expired"};
    if (response?.status !== 202) return {kind: "failed"};
    const body = await response.json().catch(() => null) as {continuationPath?: unknown; metaEvent?: MetaBrowserEventEnvelope | null} | null;
    return typeof body?.continuationPath === "string" && body.continuationPath.startsWith("/roof-estimate/continue/")
      ? {kind: "accepted", continuationPath: body.continuationPath, metaEvent: body.metaEvent ?? null}
      : {kind: "failed"};
  },
  async continueToEstimate(continuationPath) {
    const response = await fetch("/api/roof-estimate/continue", {
      method: "POST",
      headers: json,
      body: JSON.stringify({path: continuationPath}),
      credentials: "same-origin",
    }).catch(() => null);
    if (response?.status === 409) return {kind: "elsewhere"};
    const body = await readJson<{estimateToken?: unknown}>(response);
    return typeof body?.estimateToken === "string" ? {kind: "estimate", estimateToken: body.estimateToken} : {kind: "failed"};
  },
  async loadEstimate(estimateToken) {
    return readJson<ChatEstimateSummary>(await fetch(`/api/roof-estimate/${enc(estimateToken)}/summary`, {cache: "no-store"}).catch(() => null));
  },
  async bookingLink(estimateToken) {
    const body = await readJson<{token?: unknown}>(
      await fetch(`/api/roof-estimate/${enc(estimateToken)}/booking-link`, {method: "POST"}).catch(() => null),
    );
    return typeof body?.token === "string" ? body.token : null;
  },
  async bookingOverview(bookingToken) {
    return readJson<BookingPageModel>(await fetch(`/api/booking/${enc(bookingToken)}/overview`, {cache: "no-store"}).catch(() => null));
  },
  async book(bookingToken, input) {
    const response = await fetch(`/api/booking/${enc(bookingToken)}`, {
      method: "POST",
      headers: json,
      body: JSON.stringify(input),
    }).catch(() => null);
    if (response?.ok) {
      const booking = await response.json().catch(() => null) as BookingSummary | null;
      return booking?.startsAt ? {kind: "booked", booking} : {kind: "failed", message: null};
    }
    const body = await response?.json().catch(() => null) as {error?: string; code?: string} | null;
    if (body?.code === "slot_unavailable") return {kind: "taken"};
    if (body?.code === "already_booked") return {kind: "already_booked"};
    return {kind: "failed", message: body?.code === "rate_limited" || body?.code === "invalid" ? body.error ?? null : null};
  },
  async requestCallback(estimateToken, callWindow) {
    const response = await fetch(`/api/roof-estimate/${enc(estimateToken)}/callback`, {
      method: "POST",
      headers: json,
      body: JSON.stringify({callWindow}),
    }).catch(() => null);
    return Boolean(response?.ok);
  },
};
