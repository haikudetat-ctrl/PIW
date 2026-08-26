import "server-only";
import {z} from "zod";

const uuidSchema = z.uuid();
const phoneSchema = z.string().regex(/^\+[1-9][0-9]{7,14}$/);
const providerAttemptIdSchema = z.string().regex(/^VE[0-9a-fA-F]{32}$/);

const reservationSchema = z.strictObject({
  reservationId: z.uuid(),
  companyId: z.uuid(),
  to: phoneSchema,
});
const checkContextSchema = z.strictObject({
  companyId: z.uuid(),
  to: phoneSchema,
  providerAttemptId: providerAttemptIdSchema,
});
const approvalSchema = z.strictObject({
  assessmentId: z.uuid(),
  publicToken: z.uuid(),
});

export interface ResumeVerificationProvider {
  start(input: {to: string}): Promise<{providerAttemptId: string; status: "pending"}>;
  check(input: {to: string; code: string; providerAttemptId: string}): Promise<
    {approved: false} | {approved: true; providerAttemptId: string}
  >;
}

export interface ResumeVerificationRepository {
  reserveStart(input: {attemptId: string; requestIp: string}): Promise<unknown>;
  recordProviderStart(input: {
    attemptId: string;
    companyId: string;
    reservationId: string;
    providerAttemptId: string;
  }): Promise<void>;
  findCheckContext(attemptId: string): Promise<unknown>;
  approve(input: {
    attemptId: string;
    companyId: string;
    providerAttemptId: string;
  }): Promise<unknown>;
}

export type ResumeVerificationDependencies = {
  repository: ResumeVerificationRepository;
  provider: ResumeVerificationProvider;
};

export async function startResumeVerification(
  input: {attemptId: string; requestIp: string},
  dependencies: ResumeVerificationDependencies,
): Promise<{sent: boolean}> {
  const parsed = z.strictObject({
    attemptId: uuidSchema,
    requestIp: z.union([z.ipv4(), z.ipv6()]),
  }).safeParse(input);
  if (!parsed.success) return {sent: false};

  try {
    const reservation = reservationSchema.parse(
      await dependencies.repository.reserveStart(parsed.data),
    );
    const started = await dependencies.provider.start({to: reservation.to});
    const providerAttemptId = providerAttemptIdSchema.parse(
      started.providerAttemptId,
    );
    await dependencies.repository.recordProviderStart({
      attemptId: parsed.data.attemptId,
      companyId: reservation.companyId,
      reservationId: reservation.reservationId,
      providerAttemptId,
    });
    return {sent: true};
  } catch {
    return {sent: false};
  }
}

export type CheckResumeVerificationResult =
  | {approved: false}
  | {approved: true; assessmentId: string; publicToken: string};

export async function checkResumeVerification(
  input: {attemptId: string; code: string},
  dependencies: ResumeVerificationDependencies,
): Promise<CheckResumeVerificationResult> {
  const parsed = z.strictObject({
    attemptId: uuidSchema,
    code: z.string().regex(/^[0-9]{6}$/),
  }).safeParse(input);
  if (!parsed.success) return {approved: false};

  try {
    const context = checkContextSchema.parse(
      await dependencies.repository.findCheckContext(parsed.data.attemptId),
    );
    const checked = await dependencies.provider.check({
      to: context.to,
      code: parsed.data.code,
      providerAttemptId: context.providerAttemptId,
    });
    if (!checked.approved) return {approved: false};
    const approval = approvalSchema.parse(await dependencies.repository.approve({
      attemptId: parsed.data.attemptId,
      companyId: context.companyId,
      providerAttemptId: checked.providerAttemptId,
    }));
    return {approved: true, ...approval};
  } catch {
    return {approved: false};
  }
}
