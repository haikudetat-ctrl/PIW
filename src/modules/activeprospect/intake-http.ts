import {createHash, timingSafeEqual} from "node:crypto";
import type {DomainEvent} from "@/domain/events";
import type {IntakeBinding} from "./config";
import {activeProspectPayloadSchema, IntakeReplayConflict, type ActiveProspectPayload} from "./payload";

export type IntakeAcceptance = {receiptId: string; state: string; leadId: string | null; duplicate: boolean; event: DomainEvent | null};
type Dependencies = {
  getBinding(slug: string): IntakeBinding | null;
  accept(binding: IntakeBinding, payload: ActiveProspectPayload): Promise<IntakeAcceptance>;
  publish(event: DomainEvent, companyId: string): Promise<unknown>;
  now(): Date;
};

async function readBody(request: Request): Promise<string | null> {
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const {value, done} = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 65_536) {void reader.cancel().catch(() => undefined); return null;}
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

export async function handleActiveProspectIntake(request: Request, slug: string, deps: Dependencies) {
  const binding = deps.getBinding(slug);
  if (!binding?.enabled) return {status: 503, body: {outcome: "retry", category: "disabled"}};
  const token = request.headers.get("authorization")?.match(/^Bearer ([^\s]+)$/)?.[1];
  const hash = (value: string) => createHash("sha256").update(value).digest();
  const valid = token && binding.tokens.some((configured) =>
    (!configured.validUntil || new Date(configured.validUntil) > deps.now()) && timingSafeEqual(hash(token), hash(configured.value)));
  if (!valid) return {status: 401, body: {outcome: "unauthorized"}};
  if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") {
    return {status: 400, body: {outcome: "invalid", category: "content_type"}};
  }
  let raw: unknown;
  try {
    const body = await readBody(request);
    if (body === null) return {status: 413, body: {outcome: "invalid", category: "payload_too_large"}};
    raw = JSON.parse(body);
  } catch {
    return {status: 400, body: {outcome: "invalid", category: "invalid_payload"}};
  }
  const parsed = activeProspectPayloadSchema.safeParse(raw);
  if (!parsed.success) return {status: 400, body: {outcome: "invalid", category: "invalid_payload"}};
  if (parsed.data.flow_id !== binding.flowId || (parsed.data.sms_consent?.company_id && parsed.data.sms_consent.company_id !== binding.companyId)) {
    return {status: 401, body: {outcome: "unauthorized"}};
  }
  let result: IntakeAcceptance;
  try {
    result = await deps.accept(binding, parsed.data);
  } catch (error) {
    if (error instanceof IntakeReplayConflict) return {status: 409, body: {outcome: "conflict", category: "replay_changed"}};
    return {status: 503, body: {outcome: "retry", category: "persistence"}};
  }
  if (result.event) {
    try {await deps.publish(result.event, binding.companyId);} catch { /* Durable outbox retains the committed event. */ }
  }
  return {status: 200, body: {outcome: "success", receipt_id: result.receiptId, state: result.state, duplicate: result.duplicate}};
}
