import { z } from "zod";
import {
  leadIntakeInputSchema,
  type LeadIntakeInput,
} from "@/modules/leads/submit-lead-intake";

const leadIntakeFormFieldsSchema = z.object({
  name: z.string().trim().min(1, "Enter the customer's name"),
  phone: z.string().trim().min(1, "Enter a phone number"),
  email: z.email("Enter a valid email address"),
  addressLine1: z.string().trim().min(3, "Enter the property street address"),
  addressLine2: z.string().trim().optional(),
  city: z.string().trim().min(2, "Enter the property city"),
  state: z.literal("NJ"),
  postalCode: z
    .string()
    .trim()
    .regex(/^\d{5}(?:-\d{4})?$/, "Enter a 5-digit ZIP code"),
  notes: z.string().trim().optional(),
});

type LeadIntakeFormFields = z.infer<typeof leadIntakeFormFieldsSchema>;

export function formatSubmittedAddress(fields: LeadIntakeFormFields): string {
  return [
    fields.addressLine1,
    fields.addressLine2 || null,
    fields.city,
    `${fields.state} ${fields.postalCode}`,
  ]
    .filter(Boolean)
    .join(", ");
}

export function parseLeadIntakeFormData(formData: FormData): LeadIntakeInput {
  const fields = leadIntakeFormFieldsSchema.parse(Object.fromEntries(formData));

  return leadIntakeInputSchema.parse({
    name: fields.name,
    phone: fields.phone,
    email: fields.email,
    submittedAddress: formatSubmittedAddress(fields),
    notes: fields.notes || undefined,
  });
}
