import "server-only";
import {z} from "zod";

const bindingSchema = z.object({
  slug: z.string().regex(/^[a-z0-9][a-z0-9-]{0,79}$/),
  companyId: z.uuid(),
  flowId: z.string().trim().min(1).max(200),
  appointmentType: z.enum(["virtual", "in_home"]),
  contactOwner: z.enum(["piw", "external"]),
  enabled: z.boolean(),
  tokens: z.array(z.object({value: z.string().min(32).max(512), validUntil: z.iso.datetime({offset: true}).nullable()}).strict()).min(1).max(2),
}).strict();

export type IntakeBinding = z.infer<typeof bindingSchema>;

export function resolveIntakeBinding(
  slug: string,
  environment: {ACTIVEPROSPECT_INTAKE_BINDINGS_JSON?: string} = {ACTIVEPROSPECT_INTAKE_BINDINGS_JSON: process.env.ACTIVEPROSPECT_INTAKE_BINDINGS_JSON},
): IntakeBinding | null {
  try {
    const parsed = z.array(bindingSchema).min(1).safeParse(JSON.parse(environment.ACTIVEPROSPECT_INTAKE_BINDINGS_JSON ?? ""));
    if (!parsed.success) return null;
    const slugs = new Set<string>(), flows = new Set<string>(), tokens = new Set<string>();
    for (const binding of parsed.data) {
      const flow = JSON.stringify([binding.companyId, binding.flowId]);
      if (slugs.has(binding.slug) || flows.has(flow)) return null;
      slugs.add(binding.slug); flows.add(flow);
      for (const token of binding.tokens) {
        if (tokens.has(token.value)) return null;
        tokens.add(token.value);
      }
    }
    return parsed.data.find((binding) => binding.slug === slug) ?? null;
  } catch {
    return null;
  }
}
