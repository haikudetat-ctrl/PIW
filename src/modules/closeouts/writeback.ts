import { createHash } from "node:crypto";
import { JobNimbusProviderError, type JobNimbusClient } from "@/modules/jobnimbus/client";
import type { RenderedPackage } from "./package-data";

// Files a submitted closeout back to JobNimbus: the package PDF goes on the
// job first, then the job moves to the company's completed status. Writes
// are recorded per closeout and kind, and every attempt leaves its outcome
// on the row, so the production queue can show what happened.

export const MAX_WRITE_ATTEMPTS = 5;

export type CloseoutWrite = {
  id: string;
  companyId: string;
  closeoutId: string;
  kind: "attach_package" | "set_completed_status";
  attempts: number;
  jobnimbusFileJnid: string | null;
};

export type StatusContext = {
  jobJnid: string;
  targetStatus: string;
  currentStatus: string | null;
  currentStage: string | null;
};

export type JobNimbusWriter = Pick<JobNimbusClient, "requestFileUpload" | "uploadToTicket" | "updateJob">;

export type WritebackDependencies = {
  renderPackage(closeoutId: string): Promise<RenderedPackage>;
  savePackage(path: string, bytes: Uint8Array): Promise<void>;
  // Whether the hourly sync has seen this file on JobNimbus.
  isFileMirrored(companyId: string, fileJnid: string): Promise<boolean>;
  recordTicket(writeId: string, ticket: { fileJnid: string; sha256: string; path: string }): Promise<void>;
  loadStatusContext(write: CloseoutWrite): Promise<StatusContext>;
  complete(writeId: string, outcome: { status: "succeeded" | "skipped"; detail: string; fileJnid?: string }): Promise<void>;
  reschedule(writeId: string, retry: { notBefore: Date; detail: string }): Promise<void>;
  fail(writeId: string, detail: string): Promise<void>;
  createWriter(companyId: string): Promise<JobNimbusWriter>;
  now(): Date;
};

export class WritebackRefusal extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WritebackRefusal";
  }
}

export type WriteOutcome = "succeeded" | "skipped" | "retry" | "failed";

export async function processCloseoutWrite(
  write: CloseoutWrite,
  dependencies: WritebackDependencies,
): Promise<WriteOutcome> {
  try {
    return write.kind === "attach_package"
      ? await attachPackage(write, dependencies)
      : await setCompletedStatus(write, dependencies);
  } catch (error) {
    const detail = describeFailure(error);
    const terminal =
      error instanceof WritebackRefusal || (error instanceof JobNimbusProviderError && error.terminal);
    if (terminal || write.attempts >= MAX_WRITE_ATTEMPTS) {
      await dependencies.fail(write.id, detail);
      return "failed";
    }
    const delayMinutes = Math.min(60, 2 ** write.attempts);
    await dependencies.reschedule(write.id, {
      notBefore: new Date(dependencies.now().getTime() + delayMinutes * 60_000),
      detail,
    });
    return "retry";
  }
}

async function attachPackage(write: CloseoutWrite, dependencies: WritebackDependencies): Promise<WriteOutcome> {
  // An earlier attempt got as far as a JobNimbus file. If the sync has seen
  // it, the upload landed and asking again would attach a second copy.
  if (write.jobnimbusFileJnid && (await dependencies.isFileMirrored(write.companyId, write.jobnimbusFileJnid))) {
    await dependencies.complete(write.id, {
      status: "succeeded",
      detail: "The package was already on the job in JobNimbus",
      fileJnid: write.jobnimbusFileJnid,
    });
    return "succeeded";
  }

  const rendered = await dependencies.renderPackage(write.closeoutId);
  const path = `${rendered.companyId}/${write.closeoutId}/package-v${rendered.version}.pdf`;
  const sha256 = createHash("sha256").update(rendered.bytes).digest("hex");
  await dependencies.savePackage(path, rendered.bytes);

  const writer = await dependencies.createWriter(write.companyId);
  const ticket = await writer.requestFileUpload({
    relatedJnids: [rendered.jobJnid],
    filename: rendered.filename,
    description: "Job closeout package from Rake",
    type: 1,
  });
  await dependencies.recordTicket(write.id, { fileJnid: ticket.fileJnid, sha256, path });
  await writer.uploadToTicket(ticket.uploadUrl, rendered.bytes);
  await dependencies.complete(write.id, {
    status: "succeeded",
    detail: `Attached ${rendered.filename}`,
    fileJnid: ticket.fileJnid,
  });
  return "succeeded";
}

async function setCompletedStatus(write: CloseoutWrite, dependencies: WritebackDependencies): Promise<WriteOutcome> {
  const context = await dependencies.loadStatusContext(write);
  if (context.currentStatus === context.targetStatus || context.currentStage === "completed") {
    await dependencies.complete(write.id, {
      status: "skipped",
      detail: `JobNimbus already shows ${context.currentStatus ?? context.targetStatus}`,
    });
    return "skipped";
  }
  if (context.currentStage === "lost") {
    throw new WritebackRefusal("JobNimbus shows this job as lost. Check the job before marking it completed.");
  }

  const writer = await dependencies.createWriter(write.companyId);
  await writer.updateJob(context.jobJnid, { status_name: context.targetStatus });
  await dependencies.complete(write.id, {
    status: "succeeded",
    detail: `Moved from ${context.currentStatus ?? "no status"} to ${context.targetStatus}`,
  });
  return "succeeded";
}

function describeFailure(error: unknown): string {
  if (error instanceof WritebackRefusal) return error.message;
  if (error instanceof JobNimbusProviderError) {
    if (error.status === 401 || error.status === 403) {
      return `JobNimbus refused the write (HTTP ${error.status}). Check that the API key can edit jobs and files.`;
    }
    return error.status ? `JobNimbus returned HTTP ${error.status}` : "JobNimbus could not be reached";
  }
  return error instanceof Error ? error.message.slice(0, 300) : "Unknown failure";
}
