import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { parsePrefill } from "@/domain/closeouts";
import type { Database } from "@/lib/database.types";
import { JobNimbusClient } from "@/modules/jobnimbus/client";
import { resolveJobNimbusCredential } from "@/modules/jobnimbus/sync";
import { renderCloseoutPackage } from "./package-data";
import {
  CLOSEOUT_BUCKET,
  resizeWithSharp,
  type JobPhotoCandidate,
  type PhotoCloseout,
  type PhotoPrepDependencies,
} from "./photo-prep";
import { WritebackRefusal, type CloseoutWrite, type WritebackDependencies } from "./writeback";

type Db = SupabaseClient<Database>;
type Environment = Record<string, string | undefined>;

// One paced client per company per run, the same way the warehouse sync
// talks to JobNimbus.
export async function createCompanyJobNimbusClient(
  database: Db,
  companyId: string,
  environment: Environment,
): Promise<JobNimbusClient> {
  const { data, error } = await database
    .from("company_integrations")
    .select("env_key_name")
    .eq("company_id", companyId)
    .eq("provider", "jobnimbus")
    .eq("enabled", true)
    .maybeSingle();
  if (error) throw new Error("JobNimbus integration lookup failed", { cause: error });
  const apiKey = data ? resolveJobNimbusCredential(data.env_key_name, environment) : undefined;
  if (!apiKey) throw new WritebackRefusal("JobNimbus is not connected for this company");
  return new JobNimbusClient({ apiKey });
}

export function photoCloseoutFromRow(row: { id: string; company_id: string; job_jnid: string; prefill: unknown }): PhotoCloseout {
  return {
    id: row.id,
    companyId: row.company_id,
    jobJnid: row.job_jnid,
    deliveredAt: parsePrefill(row.prefill).delivered_at,
  };
}

export function createPhotoPrepDependencies(database: Db, client: JobNimbusClient): PhotoPrepDependencies {
  return {
    async listCandidates(closeout) {
      const since = closeout.deliveredAt
        ? new Date(Date.parse(closeout.deliveredAt) - 2 * 86_400_000).toISOString()
        : new Date(Date.now() - 60 * 86_400_000).toISOString();
      const { data: files, error } = await database
        .from("jn_files")
        .select("jnid, filename, content_type, jn_created_at")
        .eq("company_id", closeout.companyId)
        .eq("related_job_jnid", closeout.jobJnid)
        .like("content_type", "image/%")
        .gte("jn_created_at", since)
        .order("jn_created_at")
        .limit(400);
      if (error) throw new Error("Closeout photo listing failed", { cause: error });

      const takenAt = new Map<string, string>();
      const jnids = (files ?? []).map((file) => file.jnid);
      for (let index = 0; index < jnids.length; index += 150) {
        const { data: records, error: recordError } = await database
          .from("jobnimbus_records")
          .select("jnid, taken:payload->>date_file_created")
          .eq("company_id", closeout.companyId)
          .in("jnid", jnids.slice(index, index + 150));
        if (recordError) throw new Error("Closeout photo dates failed", { cause: recordError });
        for (const record of records ?? []) {
          const seconds = Number(record.taken);
          if (Number.isSafeInteger(seconds) && seconds > 0) takenAt.set(record.jnid, new Date(seconds * 1_000).toISOString());
        }
      }

      return (files ?? []).map(
        (file): JobPhotoCandidate => ({
          fileJnid: file.jnid,
          filename: file.filename,
          contentType: file.content_type,
          takenAt: takenAt.get(file.jnid) ?? null,
          uploadedAt: file.jn_created_at,
        }),
      );
    },
    async listPreparedFileJnids(closeoutId) {
      const { data, error } = await database.from("job_closeout_photos").select("file_jnid").eq("closeout_id", closeoutId);
      if (error) throw new Error("Prepared photo listing failed", { cause: error });
      return new Set((data ?? []).map((row) => row.file_jnid));
    },
    async download(fileJnid) {
      return (await client.downloadFile(fileJnid)).bytes;
    },
    resize: resizeWithSharp,
    async upload(path, bytes, contentType) {
      const { error } = await database.storage.from(CLOSEOUT_BUCKET).upload(path, bytes, { contentType, upsert: true });
      if (error) throw new Error("Closeout photo upload failed", { cause: error });
    },
    async recordPhoto(row) {
      const { error } = await database.from("job_closeout_photos").upsert(
        {
          company_id: row.companyId,
          closeout_id: row.closeoutId,
          file_jnid: row.fileJnid,
          filename: row.filename,
          taken_at: row.takenAt,
          uploaded_at: row.uploadedAt,
          outcome: row.outcome,
          thumb_path: row.thumbPath,
          print_path: row.printPath,
          width: row.width,
          height: row.height,
        },
        { onConflict: "closeout_id,file_jnid" },
      );
      if (error) throw new Error("Closeout photo record failed", { cause: error });
    },
  };
}

export async function finishPhotoPrep(database: Db, closeoutId: string, outcome: "ready" | "failed", detail?: string) {
  const now = new Date().toISOString();
  const { error } = await database
    .from("job_closeouts")
    .update({
      photos_status: outcome,
      photos_prepared_at: outcome === "ready" ? now : null,
      photos_error: outcome === "failed" ? (detail ?? "Photo preparation failed").slice(0, 500) : null,
      photos_claimed_until: null,
      updated_at: now,
    })
    .eq("id", closeoutId);
  if (error) throw new Error("Closeout photo status update failed", { cause: error });
}

export function closeoutWriteFromRow(row: Database["public"]["Tables"]["job_closeout_jobnimbus_writes"]["Row"]): CloseoutWrite {
  return {
    id: row.id,
    companyId: row.company_id,
    closeoutId: row.closeout_id,
    kind: row.kind === "set_completed_status" ? "set_completed_status" : "attach_package",
    attempts: row.attempts,
    jobnimbusFileJnid: row.jobnimbus_file_jnid,
  };
}

export function createWritebackDependencies(database: Db, environment: Environment): WritebackDependencies {
  const writers = new Map<string, Promise<JobNimbusClient>>();
  const update = async (writeId: string, fields: Database["public"]["Tables"]["job_closeout_jobnimbus_writes"]["Update"]) => {
    const { error } = await database
      .from("job_closeout_jobnimbus_writes")
      .update({ ...fields, claimed_until: null, updated_at: new Date().toISOString() })
      .eq("id", writeId);
    if (error) throw new Error("Closeout write update failed", { cause: error });
  };

  return {
    renderPackage: (closeoutId) => renderCloseoutPackage(database, closeoutId),
    async savePackage(path, bytes) {
      const { error } = await database.storage
        .from(CLOSEOUT_BUCKET)
        .upload(path, bytes, { contentType: "application/pdf", upsert: true });
      if (error) throw new Error("Closeout package upload failed", { cause: error });
    },
    async isFileMirrored(companyId, fileJnid) {
      const { data, error } = await database
        .from("jn_files")
        .select("jnid")
        .eq("company_id", companyId)
        .eq("jnid", fileJnid)
        .maybeSingle();
      if (error) throw new Error("Mirrored file lookup failed", { cause: error });
      return Boolean(data);
    },
    async recordTicket(writeId, ticket) {
      const { error } = await database
        .from("job_closeout_jobnimbus_writes")
        .update({ jobnimbus_file_jnid: ticket.fileJnid, package_sha256: ticket.sha256, package_path: ticket.path })
        .eq("id", writeId);
      if (error) throw new Error("Closeout upload ticket record failed", { cause: error });
    },
    async loadStatusContext(write) {
      const [closeoutResult, settingsResult] = await Promise.all([
        database.from("job_closeouts").select("job_jnid").eq("id", write.closeoutId).single(),
        database.from("job_closeout_settings").select("completed_status_name").eq("company_id", write.companyId).maybeSingle(),
      ]);
      if (closeoutResult.error) throw new Error("Closeout lookup failed", { cause: closeoutResult.error });
      const jobJnid = closeoutResult.data.job_jnid;
      const { data: job, error: jobError } = await database
        .from("jn_jobs")
        .select("status_name")
        .eq("company_id", write.companyId)
        .eq("jnid", jobJnid)
        .maybeSingle();
      if (jobError) throw new Error("Job status lookup failed", { cause: jobError });
      const currentStatus = job?.status_name ?? null;
      let currentStage: string | null = null;
      if (currentStatus) {
        const { data: stages } = await database
          .from("jobnimbus_status_stages")
          .select("company_id, stage")
          .eq("status_name", currentStatus);
        const rows = stages ?? [];
        currentStage = (rows.find((row) => row.company_id === write.companyId) ?? rows.find((row) => row.company_id === null))?.stage ?? null;
      }
      return {
        jobJnid,
        targetStatus: settingsResult.data?.completed_status_name ?? "Job Completed",
        currentStatus,
        currentStage,
      };
    },
    async complete(writeId, outcome) {
      await update(writeId, {
        status: outcome.status,
        outcome_detail: outcome.detail.slice(0, 500),
        completed_at: new Date().toISOString(),
        ...(outcome.fileJnid ? { jobnimbus_file_jnid: outcome.fileJnid } : {}),
      });
    },
    async reschedule(writeId, retry) {
      await update(writeId, { status: "queued", not_before: retry.notBefore.toISOString(), outcome_detail: retry.detail.slice(0, 500) });
    },
    async fail(writeId, detail) {
      await update(writeId, { status: "failed", outcome_detail: detail.slice(0, 500) });
    },
    createWriter(companyId) {
      let writer = writers.get(companyId);
      if (!writer) {
        writer = createCompanyJobNimbusClient(database, companyId, environment);
        writers.set(companyId, writer);
      }
      return writer;
    },
    now: () => new Date(),
  };
}
