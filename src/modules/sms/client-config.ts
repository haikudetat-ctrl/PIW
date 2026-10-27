import "server-only";
import {z} from "zod";
import {SmsProviderError, TwilioMessagingClient} from "./twilio";

const clientSchema = z.object({
  companyId: z.uuid(),
  accountSid: z.string().regex(/^AC[0-9a-fA-F]{32}$/),
  apiKeySid: z.string().regex(/^SK[0-9a-fA-F]{32}$/),
  apiKeySecret: z.string().refine((value) => value.trim().length > 0),
  authToken: z.string().refine((value) => value.trim().length > 0),
}).strict();

export type SmsClient = z.infer<typeof clientSchema>;
type SmsEnvironment = {TWILIO_SMS_CLIENTS_JSON?: string};

// A deployment secret, never a NEXT_PUBLIC value or a member-readable row.
// Safe parsing deliberately discards error details: they may contain secrets.
function clients(environment: SmsEnvironment): SmsClient[] {
  try {
    const parsed = z.array(clientSchema).min(1).safeParse(JSON.parse(environment.TWILIO_SMS_CLIENTS_JSON ?? ""));
    if (!parsed.success) return [];
    for (const key of ["companyId", "accountSid", "apiKeySid"] as const) {
      const values = parsed.data.map((client) => client[key]);
      if (new Set(values).size !== values.length) return [];
    }
    return parsed.data;
  } catch {
    return [];
  }
}

export function hasSmsClients(environment: SmsEnvironment): boolean {
  return clients(environment).length > 0;
}

export function resolveSmsClient(
  selector: {companyId: string} | {accountSid: string},
  environment: SmsEnvironment = {TWILIO_SMS_CLIENTS_JSON: process.env.TWILIO_SMS_CLIENTS_JSON},
): SmsClient | null {
  return clients(environment).find((client) => "companyId" in selector
    ? client.companyId === selector.companyId
    : client.accountSid === selector.accountSid) ?? null;
}

export async function sendCompanySms(
  companyId: string,
  input: Parameters<TwilioMessagingClient["send"]>[0],
  environment: SmsEnvironment = {TWILIO_SMS_CLIENTS_JSON: process.env.TWILIO_SMS_CLIENTS_JSON},
  fetchImpl?: typeof fetch,
) {
  const client = resolveSmsClient({companyId}, environment);
  if (!client) throw new SmsProviderError("Texting is not configured for this company");
  return new TwilioMessagingClient({...client, fetchImpl}).send(input);
}
