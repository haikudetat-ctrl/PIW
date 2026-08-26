import {z} from "zod";

export const consultationContactMethods = ["call", "text", "email"] as const;
export const consultationCallWindows = ["asap", "morning", "midday", "afternoon", "evening"] as const;
export type ConsultationContactMethod = typeof consultationContactMethods[number];
export type ConsultationCallWindow = typeof consultationCallWindows[number];
export type ConsultationPreference = {
  contactMethod: ConsultationContactMethod;
  callWindow: ConsultationCallWindow | null;
};
export type ConsultationSummary = ConsultationPreference & {
  status: "requested" | "contacted" | "booked" | "closed";
  timezone: "America/New_York";
};

export const consultationApiSuccessSchema = z.object({
  status: z.enum(["requested", "contacted", "booked", "closed"]),
  contactMethod: z.enum(consultationContactMethods),
  callWindow: z.enum(consultationCallWindows).nullable(),
  timezone: z.literal("America/New_York"),
}).strict().superRefine((value, context) => {
  if ((value.contactMethod === "call") !== (value.callWindow !== null)) {
    context.addIssue({code: "custom", message: "Invalid consultation preference"});
  }
});
