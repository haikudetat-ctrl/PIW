import { Card } from "@/components/ui/card";
import { Icon } from "@/components/ui/icons";
import { SmsComposer } from "./sms-composer";

export type ConversationMessage = {
  id: string;
  direction: "outbound" | "inbound";
  body: string;
  status: string;
  error_code: string | null;
  created_at: string;
};

const STATUS_LABEL: Record<string, string> = {
  sending: "Sending",
  queued: "Queued",
  sent: "Sent",
  delivered: "Delivered",
  undelivered: "Not delivered",
  failed: "Failed",
};

function formatStamp(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/New_York",
  });
}

export function Conversation({
  leadId,
  messages,
  to,
  consent,
  blockedReason,
  fields,
}: {
  leadId: string;
  messages: ConversationMessage[];
  to: string | null;
  consent: string;
  blockedReason: string | null;
  fields: Record<string, string | null>;
}) {
  return (
    <Card
      title="Conversation"
      right={
        <span className={`inline-flex items-center gap-1 ${blockedReason ? "text-ink-subtle" : "text-success"}`}>
          <Icon name="shield" size={13} />
          {consent}
        </span>
      }
    >
      <div id="conversation" className="flex flex-col gap-4">
        {messages.length > 0 ? (
          <ol className="flex max-h-[28rem] flex-col gap-3 overflow-y-auto">
            {messages.map((message) => {
              const outbound = message.direction === "outbound";
              const failed = message.status === "failed" || message.status === "undelivered";
              return (
                <li key={message.id} className={`flex flex-col gap-1 ${outbound ? "items-end" : "items-start"}`}>
                  <p
                    className={`max-w-[80%] rounded-2xl px-3.5 py-2 text-sm whitespace-pre-wrap ${
                      outbound ? "bg-tint text-white" : "bg-surface-muted text-ink"
                    }`}
                  >
                    {message.body}
                  </p>
                  <span className={`text-[11px] ${failed ? "text-danger" : "text-ink-subtle"}`}>
                    {formatStamp(message.created_at)} · SMS
                    {outbound ? ` · ${STATUS_LABEL[message.status] ?? message.status}` : ""}
                    {failed && message.error_code ? ` (error ${message.error_code})` : ""}
                  </span>
                </li>
              );
            })}
          </ol>
        ) : (
          <p className="text-sm text-ink-subtle">No texts with this lead yet.</p>
        )}
        <SmsComposer leadId={leadId} to={to} blockedReason={blockedReason} fields={fields} />
      </div>
    </Card>
  );
}
