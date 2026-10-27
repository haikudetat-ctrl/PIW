// @vitest-environment node
import {expect, test} from "vitest";
import {resolveIntakeBinding} from "./config";

const first = {slug: "client-a-virtual", companyId: "11111111-1111-4111-8111-111111111111", flowId: "flow-a", appointmentType: "virtual", contactOwner: "piw", enabled: true, tokens: [{value: "a-token-with-at-least-32-characters", validUntil: null}]};
const second = {...first, slug: "client-b-home", companyId: "22222222-2222-4222-8222-222222222222", flowId: "flow-b", appointmentType: "in_home", tokens: [{value: "b-token-with-at-least-32-characters", validUntil: null}]};

test("resolves each slug to its server-owned tenant, flow and appointment type", () => {
  const env = {ACTIVEPROSPECT_INTAKE_BINDINGS_JSON: JSON.stringify([first, second])};
  expect(resolveIntakeBinding(first.slug, env)).toEqual(first);
  expect(resolveIntakeBinding(second.slug, env)).toEqual(second);
  expect(resolveIntakeBinding("unknown", env)).toBeNull();
});

test.each([
  "bad-json", "{}", "[]", JSON.stringify([{...first, companyId: "bad"}]),
  JSON.stringify([first, {...second, slug: first.slug}]),
  JSON.stringify([first, {...second, tokens: first.tokens}]),
  JSON.stringify([first, {...first, slug: "another-slug"}]),
])("rejects malformed or ambiguous binding registries (%#)", (raw) => {
  expect(resolveIntakeBinding(first.slug, {ACTIVEPROSPECT_INTAKE_BINDINGS_JSON: raw})).toBeNull();
});
