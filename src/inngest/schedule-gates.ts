import { hasSmsClients } from "@/modules/sms/client-config";

// Inngest bills every scheduled run as an execution, including runs that
// return early because their feature is switched off. A scheduled function
// whose feature is off is therefore left out of the served list entirely;
// switching the feature on and redeploying registers it again.
//
// Each gate mirrors the check the function itself makes before doing any
// work, so a gated-out function would have done nothing had it run.
type Environment = Record<string, string | undefined>;

const isTrue = (value: string | undefined) => value === "true";
const isSet = (value: string | undefined) => Boolean(value?.trim());

export function estimateWebhookConfigured(
  channel: "sms" | "email",
  environment: Environment,
) {
  return isSet(
    channel === "sms"
      ? environment.ESTIMATE_SMS_WEBHOOK_URL
      : environment.ESTIMATE_EMAIL_WEBHOOK_URL,
  );
}

export const scheduleGates = {
  // The function returns before any work unless this flag is "true".
  setterCallbackSla: (environment: Environment) =>
    isTrue(environment.SETTER_CALLBACK_SLA_ENABLED),
  // Delivers only for clients in TWILIO_SMS_CLIENTS_JSON. Every job carries
  // an expiry, so jobs written while unconfigured are skipped, never sent late.
  approvedBookingSms: (environment: Environment) =>
    hasSmsClients({ TWILIO_SMS_CLIENTS_JSON: environment.TWILIO_SMS_CLIENTS_JSON }),
  // A channel without a webhook is recorded failed when it is queued (see
  // queueDeliveries in roof-estimate-worker), so nothing is left to send.
  estimateDeliverySender: (environment: Environment) =>
    estimateWebhookConfigured("sms", environment)
    || estimateWebhookConfigured("email", environment),
  // runAccessRouteSync returns early unless one of these is "true".
  accessRouteReadSync: (environment: Environment) =>
    isTrue(environment.INTEGRATIONS_LEADMASTER_ENABLED)
    || isTrue(environment.INTEGRATIONS_JOBNIMBUS_ENABLED),
};

export function onlyWhen<T>(enabled: boolean, inngestFunction: T): T[] {
  return enabled ? [inngestFunction] : [];
}
