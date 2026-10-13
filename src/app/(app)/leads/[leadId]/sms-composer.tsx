"use client";

import { useActionState, useRef, useState } from "react";
import { primaryButtonClasses } from "@/components/ui/form";
import { Icon } from "@/components/ui/icons";
import { MAX_SEGMENTS, SMS_TEMPLATES, countSegments, fillTemplate } from "@/modules/sms/rules";
import { sendSms, type SmsFormState } from "./sms-actions";

export function SmsComposer({
  leadId,
  to,
  blockedReason,
  fields,
}: {
  leadId: string;
  to: string | null;
  // Why texting is unavailable for this lead, or null when it can be texted.
  blockedReason: string | null;
  fields: Record<string, string | null>;
}) {
  const [body, setBody] = useState("");
  const formRef = useRef<HTMLFormElement>(null);
  const [state, action, pending] = useActionState<SmsFormState, FormData>(async (previous, formData) => {
    const result = await sendSms(leadId, previous, formData);
    if (result?.ok) setBody("");
    return result;
  }, null);
  const info = countSegments(body);
  const tooLong = info.segments > MAX_SEGMENTS;

  return (
    <form ref={formRef} action={action} className="flex flex-col gap-2 rounded-xl border border-border-strong p-3">
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
        <span className="text-ink-subtle">SMS{to ? ` to ${to}` : ""}</span>
        <label className="flex items-center gap-1.5 text-ink-muted">
          <Icon name="list" size={13} />
          <span className="sr-only">Template</span>
          <select
            aria-label="Template"
            className="rounded-md border border-border bg-surface px-1.5 py-0.5 text-xs"
            value=""
            disabled={Boolean(blockedReason)}
            onChange={(event) => {
              const template = SMS_TEMPLATES.find((item) => item.key === event.target.value);
              if (template) setBody(fillTemplate(template.body, fields));
            }}
          >
            <option value="">Templates…</option>
            {SMS_TEMPLATES.map((template) => (
              <option key={template.key} value={template.key}>
                {template.label} · {template.stage}
              </option>
            ))}
          </select>
        </label>
      </div>
      <textarea
        name="body"
        aria-label="Message"
        rows={3}
        value={body}
        disabled={Boolean(blockedReason) || pending}
        onChange={(event) => setBody(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) formRef.current?.requestSubmit();
        }}
        placeholder={blockedReason ?? "Write a text…"}
        className="w-full resize-y rounded-md bg-transparent text-sm text-ink outline-none placeholder:text-ink-subtle disabled:cursor-not-allowed"
      />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p role="status" className={`text-xs ${state && !state.ok ? "text-danger" : "text-ink-subtle"}`}>
          {state && !state.ok ? state.message : state?.ok ? "Sent." : null}
        </p>
        <div className="ml-auto flex items-center gap-3">
          <span className={`text-xs ${tooLong ? "text-danger" : "text-ink-subtle"}`}>
            {info.length} · {info.segments} {info.segments === 1 ? "segment" : "segments"}
          </span>
          <button
            type="submit"
            disabled={Boolean(blockedReason) || pending || !body.trim() || tooLong}
            className={`${primaryButtonClasses} disabled:cursor-not-allowed disabled:opacity-50`}
          >
            <Icon name="send" size={14} /> {pending ? "Sending…" : "Send"}
          </button>
        </div>
      </div>
    </form>
  );
}
